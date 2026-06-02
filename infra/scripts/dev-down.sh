#!/usr/bin/env bash
# dev-down.sh — stop the k3d cluster, preserving all data.
# Cluster, PVCs, Vault storage and Gitea repo survive — `make up` resumes them.
# To wipe everything and start clean, use `make destroy`.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

if ! command -v k3d > /dev/null 2>&1; then
  warn "k3d not found — nothing to do"
  exit 0
fi

if k3d cluster list 2>/dev/null | grep -q "^ops-ahead"; then
  info "Stopping cluster 'ops-ahead' (data preserved — use 'make destroy' to wipe)..."
  k3d cluster stop ops-ahead
  info "Stopped — run 'make up' to resume"
else
  warn "Cluster 'ops-ahead' not found"
fi
