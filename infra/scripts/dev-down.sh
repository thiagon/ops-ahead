#!/usr/bin/env bash
# =============================================================================
# dev-down.sh — derrubar o ambiente (equivalente a docker compose down)
# =============================================================================
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}▶${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }

if ! command -v k3d > /dev/null 2>&1; then
  warn "k3d não encontrado — nada a fazer"
  exit 0
fi

if k3d cluster list 2>/dev/null | grep -q "^ops-ahead"; then
  info "Removendo cluster 'ops-ahead'..."
  k3d cluster delete ops-ahead
  info "Pronto"
else
  warn "Cluster 'ops-ahead' não encontrado"
fi
