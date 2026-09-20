#!/usr/bin/env bash
# dev-destroy.sh — delete the k3d cluster AND wipe persisted state.
# Destructive: removes PVCs, Vault storage (.data/) and the local Gitea repo.
# For a normal stop that keeps data, use `make down`.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

if command -v k3d > /dev/null 2>&1 && k3d cluster list 2>/dev/null | grep -q "^ops-ahead"; then
  info "Deleting cluster 'ops-ahead'..."
  k3d cluster delete ops-ahead
else
  warn "Cluster 'ops-ahead' not found"
fi

wipe_data_dir
info "Done — next 'make up' bootstraps from scratch"
