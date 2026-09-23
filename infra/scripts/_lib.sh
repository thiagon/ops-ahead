# shellcheck shell=bash
# _lib.sh — shared helpers for dev-*.sh scripts.
# Do not execute directly. Use: source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

export PATH="$HOME/.local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT_DIR
VAULT_INIT_FILE="$ROOT_DIR/.data/vault-init.json"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# k3d bind-mounts .data over k3s local-path. PVC dirs are created as root (and
# other uids), so a plain rm fails with EPERM — fall back to a throwaway
# container instead of asking for host sudo.
wipe_data_dir() {
  [ -d "$ROOT_DIR/.data" ] || return 0
  info "Wiping persisted state ($ROOT_DIR/.data)..."
  if ! rm -rf "$ROOT_DIR/.data" 2>/dev/null; then
    warn "Some files are root-owned; wiping via a throwaway Docker container..."
    docker run --rm -v "$ROOT_DIR/.data:/data" busybox \
      sh -c 'rm -rf /data/..?* /data/.[!.]* /data/*' 2>/dev/null || true
    rmdir "$ROOT_DIR/.data" 2>/dev/null || true
  fi
}

# Reconcile the child Application manifests straight from the working tree via
# client-side apply, rewriting the GitHub repoURL to the internal Gitea. This is
# what makes structural changes converge: client-side apply's 3-way merge PRUNES
# fields dropped from a manifest (e.g. a removed valueFiles entry), which the
# root-app's server-side apply cannot once that field is co-owned by this manager.
# repoURL is rewritten to Gitea here, so root-app's ignoreDifferences never fights
# it. Production hosts live with the app image (apps/<app>/chart/values-prod.yaml).
# values-dev.yaml only carries the CI image tag. On k3d, values-local.yaml is
# appended. namespaces/project/ingresses are plain K8s resources synced by
# root-app, not Applications — skipped.
# Requires GITEA_ADMIN_USERNAME in the environment.
is_k3d_cluster() {
  local node
  node=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  [[ "$node" == k3d-* ]]
}

# Traefik's defaultCertificate points at cloudflare-origin. On the VM that secret
# is the Cloudflare Origin Cert (created by hand). On k3d a self-signed stand-in
# keeps Traefik happy for gitea-tls / unused *.xyz routers.
ensure_origin_tls_secret() {
  if kubectl -n kube-system get secret cloudflare-origin >/dev/null 2>&1; then
    return 0
  fi
  if is_k3d_cluster; then
    local tmp
    tmp=$(mktemp -d)
    openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout "$tmp/tls.key" -out "$tmp/tls.crt" \
      -subj "/CN=ops-ahead.localtest.me" >/dev/null 2>&1
    kubectl -n kube-system create secret tls cloudflare-origin \
      --cert="$tmp/tls.crt" --key="$tmp/tls.key" >/dev/null
    rm -rf "$tmp"
    info "cloudflare-origin: self-signed stand-in for k3d"
  else
    warn "secret cloudflare-origin missing in kube-system — create the Cloudflare Origin Cert before Full (strict)"
  fi
}

# Resolve the local overlay path for an Application name, or empty if none.
_local_overlay_for() {
  local name="$1"
  if [ -f "$ROOT_DIR/apps/$name/chart/values-local.yaml" ]; then
    printf '%s' "\$values/apps/$name/chart/values-local.yaml"
  elif [ -f "$ROOT_DIR/infra/charts/$name/values-local.yaml" ]; then
    printf '%s' "values-local.yaml"
  fi
}

reconcile_child_apps() {
  local github_repo="https://github.com/thiagon/ops-ahead"
  local gitea_repo="http://infra-gitea-http.infra.svc.cluster.local:3000/${GITEA_ADMIN_USERNAME}/ops-ahead"
  local sed_repo="s#${github_repo}#${gitea_repo}#g"
  local app_yaml name tmp use_local=0 overlay

  if [ -n "${VM_MODE:-}" ]; then
    use_local=0
  elif is_k3d_cluster; then
    use_local=1
  fi

  ensure_origin_tls_secret

  for app_yaml in "$ROOT_DIR"/infra/apps/*.yaml; do
    name="$(basename "$app_yaml" .yaml)"
    [[ "$name" =~ ^(namespaces|project|ingresses)$ ]] && continue
    tmp=$(mktemp)
    if grep -q "$github_repo" "$app_yaml"; then
      sed "$sed_repo" "$app_yaml" > "$tmp"
    else
      cp "$app_yaml" "$tmp"
    fi
    overlay="$(_local_overlay_for "$name")"
    if [ "$use_local" -eq 1 ] && [ -n "$overlay" ]; then
      # Append last so local hosts win over values-prod. `unique` keeps inject idempotent.
      yq -i \
        "(.spec.source.helm.valueFiles) |= ((. // []) + [\"${overlay}\"] | unique) |
         (.spec.sources[] | select(.helm.valueFiles != null) | .helm.valueFiles) |= (. + [\"${overlay}\"] | unique)" \
        "$tmp" 2>/dev/null || true
    else
      # Drop any previously injected local overlay (app path or chart-relative).
      yq -i 'del(.spec.source.helm.valueFiles[] | select(test("values-local\\.yaml$")))' "$tmp" 2>/dev/null || true
      yq -i 'del(.spec.sources[].helm.valueFiles[] | select(test("values-local\\.yaml$")))' "$tmp" 2>/dev/null || true
    fi
    kubectl apply -f "$tmp" > /dev/null 2>&1 && info "reconciled $name"
    rm -f "$tmp"
  done
}

# Seed every Vault KV path declared by a chart ExternalSecret. Each
# remoteRef.property is the .env var of the same name. `vault kv put` replaces
# the whole path, so a new key on an existing cluster only lands if this runs
# again — make sync / the make-up fast path call it; a first bootstrap does too.
seed_vault() {
  local pod token path prop val cmds
  local -A pairs

  [ -f "$VAULT_INIT_FILE" ] || error "Vault init file missing — run: make destroy && make up"

  pod=$(kubectl get pod -n infra -l app.kubernetes.io/name=vault \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  [ -n "${pod:-}" ] || error "Vault pod not found"

  # The root token is the one from `vault operator init`, not .env VAULT_TOKEN.
  token=$(python3 -c "import json; print(json.load(open('$VAULT_INIT_FILE'))['root_token'])")

  while IFS=$'\t' read -r path prop; do
    [ -z "$path" ] && continue
    val="${!prop:-}"
    [ -z "$val" ] && error "$prop not set in .env (declared in secret/$path)"
    pairs[$path]+=" ${prop}=\"${val}\""
  done < <(yq eval-all --no-doc '.spec.data[] | [.remoteRef.key, .remoteRef.property] | @tsv' \
    "$ROOT_DIR"/infra/charts/*/templates/external-secret.yaml | sort -u)

  [ "${#pairs[@]}" -gt 0 ] || error "No ExternalSecret paths discovered"

  cmds=""
  for path in "${!pairs[@]}"; do
    cmds+="vault kv put secret/${path}${pairs[$path]}"$'\n'
    info "secret/${path} →$(echo "${pairs[$path]}" | sed 's/="[^"]*"//g')"
  done

  # Heredoc keeps the root token out of argv (visible in ps/audit).
  kubectl exec -i -n infra "$pod" -- sh <<VAULT_SCRIPT
set -e
export VAULT_TOKEN='${token}'
vault secrets enable -path=secret kv-v2 2>/dev/null || true
vault auth enable kubernetes 2>/dev/null || true
vault write auth/kubernetes/config kubernetes_host="https://kubernetes.default.svc" >/dev/null
${cmds}
vault policy write eso-policy - <<'POLICY'
path "secret/data/*" { capabilities = ["read"] }
POLICY
vault write auth/kubernetes/role/eso-role \
  bound_service_account_names=external-secrets \
  bound_service_account_namespaces=infra \
  policies=eso-policy \
  ttl=1h >/dev/null
vault audit enable file file_path=/vault/logs/audit.log 2>/dev/null || true
VAULT_SCRIPT
}

# ESO only re-reads Vault on refreshInterval (1h) unless the ExternalSecret
# object itself changes. Bump force-sync so a just-written path is picked up now.
refresh_external_secrets() {
  local ns name ts
  ts=$(date +%s)
  while IFS=$'\t' read -r ns name; do
    [ -z "$ns" ] && continue
    kubectl annotate externalsecret "$name" -n "$ns" \
      "force-sync=${ts}" --overwrite >/dev/null 2>&1 || true
  done < <(kubectl get externalsecret -A \
    -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\n"}{end}' 2>/dev/null)

  kubectl wait externalsecret --all --all-namespaces \
    --for=condition=Ready --timeout=120s >/dev/null 2>&1 \
    && info "ESO: all ExternalSecrets ready" \
    || warn "ESO: some ExternalSecret not Ready — check ClusterSecretStore"
}
