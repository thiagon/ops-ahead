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

GITEA_PUSH_URL="http://${GITEA_ADMIN_USERNAME}:${GITEA_ADMIN_PASSWORD}@gitea.ops-ahead.localtest.me/${GITEA_ADMIN_USERNAME}/ops-ahead.git"

# Wait for the Gitea HTTP endpoint (pod-Ready is not enough — the ingress
# route may still be coming up after a cluster start).
info "Waiting for Gitea HTTP..."
for i in $(seq 1 60); do
  curl -sf "http://gitea.ops-ahead.localtest.me/api/v1/version" > /dev/null 2>&1 && break
  [ "$i" -eq 60 ] && warn "Gitea HTTP not responding after 2min — push may fail"
  sleep 2
done

# Working dir snapshot (modified + untracked) without touching the user's HEAD.
info "Snapshotting working dir..."
git add -A
TREE_HASH=$(git write-tree)
git reset > /dev/null 2>&1
COMMIT_HASH=$(git commit-tree "$TREE_HASH" -p HEAD -m "dev: working dir snapshot")

info "Pushing → local Gitea..."
git push -f "${GITEA_PUSH_URL}" "${COMMIT_HASH}:refs/heads/main" > /dev/null 2>&1 || \
  error "Push failed — check GITEA_ADMIN_PASSWORD"

info "Hard refresh on all Applications..."
for app in $(kubectl get applications -n infra -o name 2>/dev/null); do
  kubectl annotate "$app" -n infra \
    argocd.argoproj.io/refresh=hard --overwrite > /dev/null 2>&1 || true
done

info "Synced — track at http://argocd.ops-ahead.localtest.me"
