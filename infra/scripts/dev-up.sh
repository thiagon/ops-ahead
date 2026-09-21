#!/usr/bin/env bash
# dev-up.sh — GitOps bootstrap for the dev environment (k3d + ArgoCD + Vault + Gitea)
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

ENV_FILE="$ROOT_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env not found — run: make setup"
set -a; source "$ENV_FILE"; set +a

: "${VAULT_TOKEN:?'VAULT_TOKEN must be set in .env'}"
: "${GITEA_ADMIN_USERNAME:?'GITEA_ADMIN_USERNAME must be set in .env'}"
: "${GITEA_ADMIN_PASSWORD:?'GITEA_ADMIN_PASSWORD must be set in .env'}"
: "${ARGOCD_ADMIN_PASSWORD:?'ARGOCD_ADMIN_PASSWORD must be set in .env'}"
: "${ARGOCD_ADMIN_PASSWORD_HASH:?'ARGOCD_ADMIN_PASSWORD_HASH must be set in .env'}"

command -v kubectl > /dev/null 2>&1 || error "kubectl not found — run: make setup"
command -v helm    > /dev/null 2>&1 || error "helm not found — run: make setup"
command -v yq      > /dev/null 2>&1 || error "yq not found — run: make setup"
if [ -z "${VM_MODE:-}" ]; then
  docker info > /dev/null 2>&1      || error "Docker is not running"
  command -v k3d > /dev/null 2>&1   || error "k3d not found — run: make setup"
fi

cd "$ROOT_DIR"

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"

# Pin the Kubernetes version so clusters are reproducible across machines.
K3S_IMAGE="rancher/k3s:v1.31.5-k3s1"

# Seed/refresh the Secret the in-cluster auto-unsealer reads (from the persisted
# init file). No-op until Vault has been initialized at least once.
ensure_unseal_secret() {
  [ -f "$VAULT_INIT_FILE" ] || return 0
  local key
  key=$(python3 -c "import json; print(json.load(open('$VAULT_INIT_FILE'))['unseal_keys_b64'][0])")
  kubectl create secret generic vault-unseal-key \
    --from-literal=unseal-key="$key" \
    -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null
}

# Wait for the Vault pod to run, then unseal if sealed. Idempotent fallback —
# the in-cluster unsealer normally handles this; this just makes `make up`
# deterministic instead of racing the unsealer.
unseal_vault() {
  local pod key i
  for i in $(seq 1 40); do
    pod=$(kubectl get pod -n infra -l app.kubernetes.io/name=vault \
      -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
    [ -n "${pod:-}" ] && \
      [ "$(kubectl get pod -n infra "$pod" -o jsonpath='{.status.phase}' 2>/dev/null)" = "Running" ] && break
    sleep 3
  done
  [ -z "${pod:-}" ] && { warn "Vault pod did not appear"; return 0; }
  key=$(python3 -c "import json; print(json.load(open('$VAULT_INIT_FILE'))['unseal_keys_b64'][0])")
  for i in $(seq 1 30); do
    kubectl exec -n infra "$pod" -- vault status >/dev/null 2>&1 && return 0
    kubectl exec -n infra "$pod" -- vault operator unseal "$key" >/dev/null 2>&1 || true
    sleep 3
  done
}

step "Cluster"
CLUSTER_EXISTS=0
if [ -n "${VM_MODE:-}" ]; then
  # k3s owns the node; a bootstrapped root-app is what marks it as existing.
  kubectl get application ops-ahead-root -n infra > /dev/null 2>&1 && CLUSTER_EXISTS=1
  info "k3s node (VM mode)"
else
  CLUSTER_EXISTS=0
  if k3d cluster list 2>/dev/null | grep -q "^ops-ahead"; then
    CLUSTER_EXISTS=1
    info "Cluster exists — ensuring it is started..."
    k3d cluster start ops-ahead
  else
    info "Creating cluster 'ops-ahead'..."
    # A new cluster must not reattach another cluster's PVCs. Stop/start (make
    # down) keeps .data; only create wipes leftovers from a previous delete.
    wipe_data_dir
    mkdir -p "$ROOT_DIR/.data"
    k3d cluster create ops-ahead \
      --image "$K3S_IMAGE" \
      --port "80:80@loadbalancer" \
      --port "443:443@loadbalancer" \
      --registry-config "$SCRIPT_DIR/registries.yaml" \
      --host-alias "127.0.0.1:gitea.ops-ahead.localtest.me" \
      --volume "$ROOT_DIR/.data:/var/lib/rancher/k3s/storage@server:0" \
      --wait
  fi

  # k3d sets `unless-stopped` on its containers, so a host reboot brings the whole
  # cluster back up on its own. Reset it on every run: `docker update` only reaches
  # containers that exist now, and `k3d cluster create` mints new ones.
  docker ps -aq --filter "label=k3d.cluster=ops-ahead" \
    | xargs -r docker update --restart=no >/dev/null
fi

# k3d sets `unless-stopped` on its containers, so a host reboot brings the whole
# cluster back up on its own. Reset it on every run: `docker update` only reaches
# containers that exist now, and `k3d cluster create` mints new ones.
docker ps -aq --filter "label=k3d.cluster=ops-ahead" \
  | xargs -r docker update --restart=no >/dev/null

# Wait for the node to answer (matters right after a `k3d cluster start`).
for i in $(seq 1 40); do
  kubectl get nodes 2>/dev/null | grep -q " Ready" && break
  sleep 3
done
kubectl get nodes

# Fast path: a previously bootstrapped cluster only needs to be resumed. All
# workloads persist in etcd across stop/start, so skip the heavy bootstrap —
# unseal Vault, rewrite KV from the charts' ExternalSecrets (dev-sync), and
# push the working dir. ArgoCD self-heals the rest. (Run `make destroy` to
# force a clean bootstrap.)
if [ "$CLUSTER_EXISTS" = "1" ] && [ -f "$VAULT_INIT_FILE" ] \
   && kubectl get application ops-ahead-root -n infra > /dev/null 2>&1; then
  step "Resuming existing cluster (fast path)"
  ensure_unseal_secret
  unseal_vault
  info "Vault unsealed — pushing working dir + refreshing ArgoCD"
  bash "$SCRIPT_DIR/dev-sync.sh"
  step "Done"
  echo ""
  echo "  Resumed (data preserved). Iterate:  edit charts/manifests and run  make sync"
  echo ""
  exit 0
fi

if [ "$CLUSTER_EXISTS" = "1" ]; then
  info "Cluster exists but GitOps is not bootstrapped yet — continuing full bootstrap"
fi

step "Chart dependencies"
for chart_dir in infra/charts/*/; do
  grep -q "^dependencies:" "${chart_dir}Chart.yaml" 2>/dev/null || continue
  if ! helm dependency build "./$chart_dir" > /dev/null 2>&1; then
    helm dependency update "./$chart_dir"
  fi
  info "$(basename "$chart_dir") OK"
done

step "Bootstrap ArgoCD + Vault + Gitea"
# ArgoCD, Vault and Gitea must exist before root-app — after that GitOps takes
# over (waves 0-2). Gitea is dev-only: ArgoCD is pull-based and needs a Git URL,
# so we use a local Gitea instead of GitHub.
kubectl apply -f infra/apps/namespaces.yaml > /dev/null

# admin.password (bcrypt) + passwordMtime set directly so ArgoCD uses the fixed
# dev password from .env instead of generating argocd-initial-admin-secret.
kubectl delete secret argocd-secret -n infra --ignore-not-found > /dev/null 2>&1
ARGOCD_SERVER_SECRETKEY=$(openssl rand -base64 32)
kubectl create secret generic argocd-secret \
  --from-literal=server.secretkey="${ARGOCD_SERVER_SECRETKEY}" \
  --from-literal=admin.password="${ARGOCD_ADMIN_PASSWORD_HASH}" \
  --from-literal=admin.passwordMtime="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# Gitea comes up before Vault/ESO, so the secret is created directly (dev-only).
kubectl create secret generic gitea-admin-secret \
  --from-literal=username="${GITEA_ADMIN_USERNAME}" \
  --from-literal=password="${GITEA_ADMIN_PASSWORD}" \
  -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

helm upgrade --install infra-argocd ./infra/charts/infra-argocd \
  -n infra \
  -f infra/charts/infra-argocd/values.yaml \
  -f infra/charts/infra-argocd/values-dev.yaml \
  --wait --timeout 10m
info "ArgoCD ready"

helm upgrade --install infra-vault ./infra/charts/infra-vault \
  -n infra \
  -f infra/charts/infra-vault/values.yaml \
  -f infra/charts/infra-vault/values-dev.yaml \
  --timeout 5m
info "Vault deployed (standalone)"

# Vault standalone starts sealed — wait for pod to exist, then Running, then respond.
for i in $(seq 1 40); do
  VAULT_POD=$(kubectl get pod -n infra -l app.kubernetes.io/name=vault \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
  [ -n "${VAULT_POD:-}" ] && break
  sleep 3
done
[ -z "${VAULT_POD:-}" ] && error "Vault pod did not appear within 2min"

for i in $(seq 1 40); do
  PHASE=$(kubectl get pod -n infra "$VAULT_POD" -o jsonpath='{.status.phase}' 2>/dev/null)
  [ "$PHASE" = "Running" ] && break
  sleep 3
done

# Wait until vault binary responds (sealed = exit 2, uninitialized = exit 2, ok = exit 0)
for i in $(seq 1 30); do
  kubectl exec -n infra "$VAULT_POD" -- vault status -format=json \
    > /tmp/vault-status.json 2>/dev/null || true
  [ -s /tmp/vault-status.json ] && break
  sleep 2
done

mkdir -p "$ROOT_DIR/.data"

IS_INIT=$(python3 -c \
  "import json; d=json.load(open('/tmp/vault-status.json')); print(d.get('initialized',False))" \
  2>/dev/null || echo "False")

if [ "$IS_INIT" != "True" ]; then
  info "Initializing Vault (first run)..."
  kubectl exec -n infra "$VAULT_POD" -- \
    vault operator init -key-shares=1 -key-threshold=1 -format=json \
    > "$VAULT_INIT_FILE"
  info "Init output → .data/vault-init.json"
fi

UNSEAL_KEY=$(python3 -c "import json; print(json.load(open('$VAULT_INIT_FILE'))['unseal_keys_b64'][0])")
VAULT_TOKEN=$(python3 -c "import json; print(json.load(open('$VAULT_INIT_FILE'))['root_token'])")

kubectl exec -n infra "$VAULT_POD" -- vault status -format=json \
  > /tmp/vault-status.json 2>/dev/null || true
IS_SEALED=$(python3 -c \
  "import json; d=json.load(open('/tmp/vault-status.json')); print(d.get('sealed',True))" \
  2>/dev/null || echo "True")

if [ "$IS_SEALED" = "True" ]; then
  kubectl exec -n infra "$VAULT_POD" -- vault operator unseal "$UNSEAL_KEY" > /dev/null
  info "Vault unsealed"
fi

kubectl wait pod -n infra "$VAULT_POD" --for=condition=Ready --timeout=60s > /dev/null
info "Vault ready"

# Hand the unseal key to the in-cluster auto-unsealer for future restarts.
ensure_unseal_secret

# No --wait: the act-runner (in this chart) mounts the gitea-runner-token
# secret, which we can only mint from the Gitea API further down — waiting on
# the whole release here would deadlock. Gitea readiness is asserted by the
# curl loop below; the runner recovers once the token secret exists.
helm upgrade --install infra-gitea ./infra/charts/infra-gitea \
  -n infra \
  -f infra/charts/infra-gitea/values.yaml \
  -f infra/charts/infra-gitea/values-dev.yaml \
  --timeout 5m
info "Gitea installed"

step "Push working dir to Gitea"

GITEA_EXTERNAL="http://gitea.ops-ahead.localtest.me"
GITEA_INTERNAL="http://infra-gitea-http.infra.svc.cluster.local:3000"
GITEA_REPO_URL="${GITEA_INTERNAL}/${GITEA_ADMIN_USERNAME}/ops-ahead.git"

# Ingress applied manually — without it the external host returns 404 until
# root-app syncs. Idempotent: root-app recreates it later.
kubectl apply -f - > /dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: gitea
  namespace: infra
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  ingressClassName: traefik
  rules:
    - host: gitea.ops-ahead.localtest.me
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: infra-gitea-http
                port:
                  number: 3000
EOF

for i in {1..30}; do
  curl -sf "${GITEA_EXTERNAL}/api/v1/version" > /dev/null 2>&1 && break
  sleep 2
done

curl -s -X POST -u "${GITEA_ADMIN_USERNAME}:${GITEA_ADMIN_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d '{"name":"ops-ahead","auto_init":false,"private":false}' \
  "${GITEA_EXTERNAL}/api/v1/user/repos" > /dev/null

# Gitea Actions runner registration token → Secret the act_runner pod reads.
# Regenerated each full bootstrap; the token is instance-wide, not per-repo.
RUNNER_TOKEN=$(curl -s -u "${GITEA_ADMIN_USERNAME}:${GITEA_ADMIN_PASSWORD}" \
  "${GITEA_EXTERNAL}/api/v1/admin/runners/registration-token" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
if [ -n "$RUNNER_TOKEN" ]; then
  kubectl create secret generic gitea-runner-token \
    --from-literal=token="$RUNNER_TOKEN" \
    -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null
  info "Gitea Actions runner token → secret/gitea-runner-token"
else
  warn "Could not fetch runner registration token — act_runner will not register"
fi

# Actions secret the build workflow uses to log into the Gitea registry.
# The automatic GITEA_TOKEN cannot auth to the package registry, so we hand the
# admin password (same credential `make push` used) to the workflow explicitly.
curl -s -X PUT -u "${GITEA_ADMIN_USERNAME}:${GITEA_ADMIN_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d "{\"data\":\"${GITEA_ADMIN_PASSWORD}\"}" \
  "${GITEA_EXTERNAL}/api/v1/repos/${GITEA_ADMIN_USERNAME}/ops-ahead/actions/secrets/REGISTRY_PASSWORD" > /dev/null
info "Actions secret REGISTRY_PASSWORD set on repo"

# Working dir snapshot (modified + untracked) without touching the user's HEAD.
GITEA_PUSH_URL="http://${GITEA_ADMIN_USERNAME}:${GITEA_ADMIN_PASSWORD}@gitea.ops-ahead.localtest.me/${GITEA_ADMIN_USERNAME}/ops-ahead.git"
FORCE_MARKER=".ci/force-build"
if [ -n "${FORCE:-}" ]; then
  mkdir -p "$(dirname "$FORCE_MARKER")"
  touch "$FORCE_MARKER"
  info "FORCE=1 — every app image will be rebuilt"
fi
git add -A
[ -f "$FORCE_MARKER" ] && git add -f "$FORCE_MARKER"
TREE_HASH=$(git write-tree)
git reset > /dev/null 2>&1
rm -f "$FORCE_MARKER"
COMMIT_HASH=$(git commit-tree "$TREE_HASH" -p HEAD -m "dev: working dir snapshot")
if git push -f "${GITEA_PUSH_URL}" "${COMMIT_HASH}:refs/heads/main" > /dev/null 2>&1; then
  info "Snapshot → ${GITEA_ADMIN_USERNAME}/ops-ahead@main"
else
  warn "Snapshot push failed — run 'make sync' once Gitea is accessible"
fi

# ArgoCD repo secret pointing to internal Gitea (cluster-internal, no ingress).
kubectl create secret generic gitea-repo-secret \
  --from-literal=type=git \
  --from-literal=url="${GITEA_REPO_URL}" \
  --from-literal=username="${GITEA_ADMIN_USERNAME}" \
  --from-literal=password="${GITEA_ADMIN_PASSWORD}" \
  -n infra --dry-run=client -o yaml \
  | kubectl label --local -f - --dry-run=client -o yaml \
      argocd.argoproj.io/secret-type=repository \
  | kubectl apply -f - > /dev/null

step "Root Application (App-of-Apps)"

# Rewrite repoURL from GitHub to internal Gitea in every Application.
GITHUB_REPO="https://github.com/thiagon/ops-ahead"
SED_REPO="s#${GITHUB_REPO}#${GITEA_REPO_URL%.git}#g"

sed "${SED_REPO}" infra/bootstrap/root-app.yaml | kubectl apply -f -
info "ops-ahead-root → ${GITEA_REPO_URL}"

reconcile_child_apps

step "Bootstrap Vault"
kubectl wait pod -l app.kubernetes.io/name=vault -n infra \
  --for=condition=Ready --timeout=120s > /dev/null

seed_vault
info "Vault: secrets and ESO role configured"

step "Waiting for ESO to sync secrets"
kubectl wait pod -l app.kubernetes.io/instance=infra-eso -n infra \
  --for=condition=Ready --timeout=180s > /dev/null 2>&1 || warn "ESO pod did not become Ready within 3min"

refresh_external_secrets

step "Labels"
# Apply monitoring label to declared namespaces — source: namespaces.yaml.
while IFS= read -r ns; do
  kubectl get namespace "$ns" > /dev/null 2>&1 && \
    kubectl label namespace "$ns" ops-ahead/monitor=true --overwrite > /dev/null || \
    warn "namespace $ns does not exist yet — label will be applied once ArgoCD creates it"
done < <(yq eval-all 'select(.kind == "Namespace") | .metadata.name' infra/apps/namespaces.yaml | grep -Ev "^(---|null)$")

step "Done"

echo ""
echo "  Iterate:  edit charts/manifests and run  make sync"
echo ""
