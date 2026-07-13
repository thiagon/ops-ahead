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

if [ -d "$ROOT_DIR/.data" ]; then
  info "Wiping persisted state ($ROOT_DIR/.data)..."
  # PVC dirs are created by containers running as root (and other uids), so a
  # plain rm fails with EPERM. Try it first; on failure, let Docker (already
  # root) do the delete so we never need host sudo.
  if ! rm -rf "$ROOT_DIR/.data" 2>/dev/null; then
    warn "Some files are root-owned; wiping via a throwaway Docker container..."
    docker run --rm -v "$ROOT_DIR/.data:/data" busybox sh -c 'rm -rf /data/..?* /data/.[!.]* /data/*' 2>/dev/null || true
    rmdir "$ROOT_DIR/.data" 2>/dev/null || true
  fi
fi
info "Done — next 'make up' bootstraps from scratch"
