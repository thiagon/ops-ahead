#!/usr/bin/env bash
# dev-down.sh — tear down the k3d cluster
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

if ! command -v k3d > /dev/null 2>&1; then
  warn "k3d not found — nothing to do"
  exit 0
fi

if k3d cluster list 2>/dev/null | grep -q "^ops-ahead"; then
  info "Removing cluster 'ops-ahead'..."
  k3d cluster delete ops-ahead
  info "Done"
else
  warn "Cluster 'ops-ahead' not found"
fi
