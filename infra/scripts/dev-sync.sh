#!/usr/bin/env bash
# =============================================================================
# dev-sync.sh — push do working dir pro Gitea local + refresh ArgoCD
#
# Use após editar charts/manifests pra propagar pro cluster sem rebuild:
#   make sync
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }

ENV_FILE="$ROOT_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env não encontrado — rode: make setup"
set -a; source "$ENV_FILE"; set +a

: "${GITEA_ADMIN_PASSWORD:?'Defina GITEA_ADMIN_PASSWORD no .env'}"

cd "$ROOT_DIR"

# Verifica que o cluster está rodando
kubectl get ns infra > /dev/null 2>&1 || error "Cluster não encontrado — rode: make up"

GITEA_PUSH_URL="http://ops-ahead:${GITEA_ADMIN_PASSWORD}@gitea.ops-ahead.localtest.me/ops-ahead/ops-ahead.git"

# Snapshot do working dir (inclui modified + untracked) → commit temporário
# sem mexer em branches locais nem no HEAD do user. Push esse commit pro Gitea.
info "Snapshotando working dir..."
git add -A
TREE_HASH=$(git write-tree)
git reset > /dev/null 2>&1
COMMIT_HASH=$(git commit-tree "$TREE_HASH" -p HEAD -m "dev: working dir snapshot")

info "Pushing snapshot → Gitea local..."
git push -f "${GITEA_PUSH_URL}" "${COMMIT_HASH}:refs/heads/main" > /dev/null 2>&1 || \
  error "Push falhou — verifique GITEA_ADMIN_PASSWORD"
info "Push OK"

# Trigger refresh de todas as Applications no ArgoCD (annotation hard-refresh)
info "Disparando refresh no ArgoCD..."
for app in $(kubectl get applications -n infra -o name 2>/dev/null); do
  kubectl annotate "$app" -n infra \
    argocd.argoproj.io/refresh=hard --overwrite > /dev/null 2>&1 || true
done

info "Sincronizado. Acompanhe em http://argocd.ops-ahead.localtest.me"
