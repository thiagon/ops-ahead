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

docker info > /dev/null 2>&1        || error "Docker is not running"
command -v kubectl > /dev/null 2>&1 || error "kubectl not found — run: make setup"
command -v helm    > /dev/null 2>&1 || error "helm not found — run: make setup"
command -v k3d     > /dev/null 2>&1 || error "k3d not found — run: make setup"
command -v yq      > /dev/null 2>&1 || error "yq not found — run: make setup"

cd "$ROOT_DIR"

step "k3d cluster"
if k3d cluster list 2>/dev/null | grep -q "^ops-ahead"; then
  info "Cluster already exists"
else
  info "Creating cluster 'ops-ahead'..."
  k3d cluster create ops-ahead \
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer" \
    --wait
fi
kubectl get nodes

step "Chart dependencies"
for chart_dir in infra/charts/*/; do
  grep -q "^dependencies:" "${chart_dir}Chart.yaml" 2>/dev/null || continue
  helm dependency build "./$chart_dir" > /dev/null 2>&1 || \
  helm dependency update "./$chart_dir" > /dev/null
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
  --wait --timeout 10m 2>/dev/null
info "ArgoCD ready"

helm upgrade --install infra-vault ./infra/charts/infra-vault \
  -n infra \
  -f infra/charts/infra-vault/values.yaml \
  -f infra/charts/infra-vault/values-dev.yaml \
  --set vault.server.dev.devRootToken="${VAULT_TOKEN}" \
  --wait --timeout 5m 2>/dev/null
info "Vault ready"

helm upgrade --install infra-gitea ./infra/charts/infra-gitea \
  -n infra \
  -f infra/charts/infra-gitea/values.yaml \
  -f infra/charts/infra-gitea/values-dev.yaml \
  --wait --timeout 5m 2>/dev/null
info "Gitea ready"

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

# Working dir snapshot (modified + untracked) without touching the user's HEAD.
GITEA_PUSH_URL="http://${GITEA_ADMIN_USERNAME}:${GITEA_ADMIN_PASSWORD}@gitea.ops-ahead.localtest.me/${GITEA_ADMIN_USERNAME}/ops-ahead.git"
git add -A
TREE_HASH=$(git write-tree)
git reset > /dev/null 2>&1
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

sed "${SED_REPO}" infra/bootstrap/root-app.yaml | kubectl apply -f - 2>/dev/null
info "ops-ahead-root → ${GITEA_REPO_URL}"

for app_yaml in infra/apps/*.yaml; do
  name="$(basename "$app_yaml" .yaml)"
  # namespaces/project/ingresses are K8s resources, not Applications — root-app syncs them.
  [[ "$name" =~ ^(namespaces|project|ingresses)$ ]] && continue
  if grep -q "$GITHUB_REPO" "$app_yaml"; then
    sed "${SED_REPO}" "$app_yaml" | kubectl apply -f - > /dev/null 2>&1
    info "$name OK"
  else
    kubectl apply -f "$app_yaml" > /dev/null 2>&1
    info "$name (external chart)"
  fi
done

step "Bootstrap Vault"
kubectl wait pod -l app.kubernetes.io/name=vault -n infra \
  --for=condition=Ready --timeout=120s > /dev/null

VAULT_POD=$(kubectl get pod -n infra -l app.kubernetes.io/name=vault \
  -o jsonpath='{.items[0].metadata.name}')

# Discover paths and properties from each chart's ExternalSecret and build the
# `vault kv put` commands. Convention: each `remoteRef.property` matches a var
# with the same name in .env. Adding an app = external-secret.yaml + .env vars.
declare -A VAULT_PAIRS
while IFS=$'\t' read -r path prop; do
  [ -z "$path" ] && continue
  val="${!prop:-}"
  [ -z "$val" ] && error "$prop not set in .env (declared in secret/$path)"
  VAULT_PAIRS[$path]+=" ${prop}=\"${val}\""
done < <(yq eval-all --no-doc '.spec.data[] | [.remoteRef.key, .remoteRef.property] | @tsv' \
  infra/charts/*/templates/external-secret.yaml 2>/dev/null | sort -u)

VAULT_KV_CMDS=""
for path in "${!VAULT_PAIRS[@]}"; do
  VAULT_KV_CMDS+="vault kv put secret/${path}${VAULT_PAIRS[$path]}"$'\n'
  info "secret/${path} →$(echo "${VAULT_PAIRS[$path]}" | sed 's/="[^"]*"//g')"
done

# Heredoc keeps VAULT_TOKEN out of argv (visible in ps/audit).
kubectl exec -i -n infra "$VAULT_POD" -- sh << VAULT_SCRIPT
export VAULT_TOKEN='${VAULT_TOKEN}'
vault auth enable kubernetes 2>/dev/null || true
vault write auth/kubernetes/config kubernetes_host="https://kubernetes.default.svc" > /dev/null

${VAULT_KV_CMDS}
vault policy write eso-policy - << 'POLICY'
path "secret/data/*" { capabilities = ["read"] }
POLICY

vault write auth/kubernetes/role/eso-role \
  bound_service_account_names=external-secrets \
  bound_service_account_namespaces=infra \
  policies=eso-policy \
  ttl=1h > /dev/null

vault audit enable file file_path=/vault/logs/audit.log 2>/dev/null || true
VAULT_SCRIPT
info "Vault: secrets and ESO role configured"

step "Waiting for ESO to sync secrets"
kubectl wait pod -l app.kubernetes.io/name=external-secrets -n infra \
  --for=condition=Ready --timeout=180s > /dev/null 2>&1 || warn "ESO pod did not become Ready within 3min"

kubectl wait externalsecret --all --all-namespaces \
  --for=condition=Ready --timeout=120s > /dev/null 2>&1 \
  && info "ESO: all ExternalSecrets ready" \
  || warn "ESO: some ExternalSecret not Ready — check ClusterSecretStore"

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
