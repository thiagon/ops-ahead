#!/usr/bin/env bash
# =============================================================================
# dev-down.sh — Tear down the Ops Ahead local dev cluster
# Uso: ./scripts/dev-down.sh
# =============================================================================
set -euo pipefail

CLUSTER_NAME="ops-ahead"
DOMAIN="ops-ahead.local"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }

if ! command -v k3d > /dev/null 2>&1; then
  warn "k3d não encontrado — nada a remover"
  exit 0
fi

if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}"; then
  info "Removendo cluster '${CLUSTER_NAME}'..."
  k3d cluster delete "$CLUSTER_NAME"
  info "Cluster removido"
else
  warn "Cluster '${CLUSTER_NAME}' não encontrado"
fi

# Remove /etc/hosts entries
SUBDOMAINS=(
  "argocd" "grafana" "prometheus"
  "mlflow" "minio" "argo-workflows"
  "litellm" "gateway" "ui"
)

ENTRIES_FOUND=false
for sub in "${SUBDOMAINS[@]}"; do
  if grep -q "${sub}.${DOMAIN}" /etc/hosts 2>/dev/null; then
    ENTRIES_FOUND=true
    break
  fi
done

if $ENTRIES_FOUND; then
  if [ -w /etc/hosts ]; then
    for sub in "${SUBDOMAINS[@]}"; do
      sed -i "/${sub}.${DOMAIN}/d" /etc/hosts 2>/dev/null || true
    done
    info "/etc/hosts limpo"
  else
    warn "Remova manualmente do /etc/hosts:"
    for sub in "${SUBDOMAINS[@]}"; do
      echo "  127.0.0.1 ${sub}.${DOMAIN}"
    done
  fi
fi

info "Pronto. Execute ./scripts/dev-up.sh para subir novamente."
