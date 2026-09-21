#!/usr/bin/env bash
# dev-sync.sh — push working dir to local Gitea + refresh ArgoCD
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

ENV_FILE="$ROOT_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env not found — run: make setup"
set -a; source "$ENV_FILE"; set +a

: "${GITEA_ADMIN_USERNAME:?'GITEA_ADMIN_USERNAME must be set in .env'}"
: "${GITEA_ADMIN_PASSWORD:?'GITEA_ADMIN_PASSWORD must be set in .env'}"

cd "$ROOT_DIR"

kubectl get ns infra > /dev/null 2>&1 || error "Cluster not found — run: make up"

# Charts may have grown new ExternalSecret keys since the last full bootstrap.
# Rewrite Vault from the templates + .env so make sync (and the make-up fast
# path) pick them up without `make destroy`.
step "Vault secrets"
seed_vault

GITEA_PUSH_URL="http://${GITEA_ADMIN_USERNAME}:${GITEA_ADMIN_PASSWORD}@gitea.ops-ahead.localtest.me/${GITEA_ADMIN_USERNAME}/ops-ahead.git"

# Wait for the Gitea HTTP endpoint (pod-Ready is not enough — the ingress
# route may still be coming up after a cluster start).
info "Waiting for Gitea HTTP..."
for i in $(seq 1 60); do
  curl -sf "http://gitea.ops-ahead.localtest.me/api/v1/version" > /dev/null 2>&1 && break
  [ "$i" -eq 60 ] && warn "Gitea HTTP not responding after 2min — push may fail"
  sleep 2
done

# Pull-forward CI-managed image tags. The snapshot below force-pushes over main,
# which would revert the tags Gitea Actions wrote back on an incremental sync
# (resume / `make sync`). Each app pins its image inside its per-env overlay
# (values-dev.yaml), alongside hand-edited config — so fetch Gitea's copy and
# merge only the CI-owned image key into the local file, leaving local edits to
# the rest of that overlay intact. The pulled tag only needs to live in the
# snapshot pushed to Gitea: each mutated overlay is backed up here and restored
# after the push, keeping the working tree as the user left it.
GITEA_RAW="http://gitea.ops-ahead.localtest.me/${GITEA_ADMIN_USERNAME}/ops-ahead/raw/branch/main"
PULL_FORWARD_BACKUP=$(mktemp -d)
pull_forward_key() {
  local f="$1" key="$2" remote val
  remote=$(mktemp)
  if curl -sf "${GITEA_RAW}/${f}" -o "$remote" 2>/dev/null && [ -s "$remote" ]; then
    val=$(yq "$key // \"\"" "$remote")
    if [ -n "$val" ]; then
      mkdir -p "$PULL_FORWARD_BACKUP/$(dirname "$f")"
      cp "$f" "$PULL_FORWARD_BACKUP/$f"
      VAL="$val" yq -i "$key = strenv(VAL)" "$f"; info "pull-forward ${f} (${key})"
    fi
  fi
  rm -f "$remote"
}
restore_pulled_overlays() {
  local f
  while IFS= read -r f; do
    cp "$PULL_FORWARD_BACKUP/$f" "$f"
  done < <(cd "$PULL_FORWARD_BACKUP" && find . -type f | sed 's|^\./||')
}
FORCE_MARKER=".ci/force-build"
# On any exit — a failed push, Ctrl-C, a closed pipe — the working tree still
# goes back to what the user left. Restoring twice copies the same bytes.
trap 'restore_pulled_overlays; rm -rf "$PULL_FORWARD_BACKUP"; rm -f "$FORCE_MARKER"' EXIT
# Same rule as the Gitea Actions write-back: every app pins <app>.image.tag,
# keyed by its own name. Discovered from the overlays themselves — owning one
# is what makes an app's tag CI-managed.
for overlay in apps/*/chart/values-dev.yaml; do
  [ -e "$overlay" ] || continue
  app=$(basename "$(dirname "$(dirname "$overlay")")")
  pull_forward_key "$overlay" ".[\"${app}\"].image.tag"
done

if [ -n "${FORCE:-}" ]; then
  mkdir -p "$(dirname "$FORCE_MARKER")"
  touch "$FORCE_MARKER"
  info "FORCE=1 — every app image will be rebuilt"
fi

# Working dir snapshot (modified + untracked) without touching the user's HEAD.
info "Snapshotting working dir..."
git add -A
[ -f "$FORCE_MARKER" ] && git add -f "$FORCE_MARKER"
TREE_HASH=$(git write-tree)
git reset > /dev/null 2>&1
COMMIT_HASH=$(git commit-tree "$TREE_HASH" -p HEAD -m "dev: working dir snapshot")

info "Pushing → local Gitea..."
git push -f "${GITEA_PUSH_URL}" "${COMMIT_HASH}:refs/heads/main" > /dev/null 2>&1 || \
  error "Push failed — check GITEA_ADMIN_PASSWORD"

restore_pulled_overlays

# Reconcile child App specs directly so structural changes (dropped valueFiles,
# changed sources) converge — root-app's server-side apply can't prune those.
info "Reconciling child Applications..."
reconcile_child_apps

info "Hard refresh on all Applications..."
for app in $(kubectl get applications -n infra -o name 2>/dev/null); do
  kubectl annotate "$app" -n infra \
    argocd.argoproj.io/refresh=hard --overwrite > /dev/null 2>&1 || true
done

info "Refreshing ExternalSecrets from Vault..."
refresh_external_secrets

info "Synced — track at http://argocd.ops-ahead.localtest.me"
