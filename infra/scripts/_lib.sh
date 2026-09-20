# shellcheck shell=bash
# _lib.sh — shared helpers for dev-*.sh scripts.
# Do not execute directly. Use: source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

export PATH="$HOME/.local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT_DIR

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
# it. namespaces/project/ingresses are plain K8s resources synced by root-app, not
# Applications — skipped. Requires GITEA_ADMIN_USERNAME in the environment.
reconcile_child_apps() {
  local github_repo="https://github.com/thiagon/ops-ahead"
  local gitea_repo="http://infra-gitea-http.infra.svc.cluster.local:3000/${GITEA_ADMIN_USERNAME}/ops-ahead"
  local sed_repo="s#${github_repo}#${gitea_repo}#g"
  local app_yaml name
  for app_yaml in "$ROOT_DIR"/infra/apps/*.yaml; do
    name="$(basename "$app_yaml" .yaml)"
    [[ "$name" =~ ^(namespaces|project|ingresses)$ ]] && continue
    if grep -q "$github_repo" "$app_yaml"; then
      sed "$sed_repo" "$app_yaml" | kubectl apply -f - > /dev/null 2>&1 && info "reconciled $name"
    else
      kubectl apply -f "$app_yaml" > /dev/null 2>&1 && info "reconciled $name (external chart)"
    fi
  done
}
