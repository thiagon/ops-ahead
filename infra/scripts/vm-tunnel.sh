#!/usr/bin/env bash
# vm-tunnel.sh — SSH LocalForward so *.ops-ahead.localtest.me on this machine
# reaches Traefik on the VM (same URLs as k3d, no per-service ports).
#
# Prerequisite: DNS for localtest.me already resolves to 127.0.0.1.
# While the tunnel is up, do not bind :80/:443 locally (stop k3d if needed).
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

ENV_FILE="$ROOT_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env not found — run: make setup"
set -a; source "$ENV_FILE"; set +a

: "${OPS_AHEAD_VM_HOST:?'OPS_AHEAD_VM_HOST must be set in .env (VM IPv4 or DNS)'}"
OPS_AHEAD_VM_USER="${OPS_AHEAD_VM_USER:-root}"
OPS_AHEAD_VM_SSH_PORT="${OPS_AHEAD_VM_SSH_PORT:-22}"

for port in 80 443; do
  if ss -ltn "( sport = :$port )" 2>/dev/null | tail -n +2 | grep -q .; then
    error "local :$port is already in use — stop k3d (make down) or whatever holds it, then retry"
  fi
done

step "SSH tunnel → ${OPS_AHEAD_VM_USER}@${OPS_AHEAD_VM_HOST}"
info "Forwards 127.0.0.1:80 and :443 → VM Traefik"
echo ""
echo "  Internal URLs (while this runs):"
echo "    http://argocd.ops-ahead.localtest.me"
echo "    http://vault.ops-ahead.localtest.me"
echo "    http://grafana.ops-ahead.localtest.me"
echo "    http://prometheus.ops-ahead.localtest.me"
echo "    http://mlflow.ops-ahead.localtest.me"
echo "    http://minio.ops-ahead.localtest.me"
echo "    http://gitea.ops-ahead.localtest.me"
echo ""
echo "  Public (Cloudflare, no tunnel): https://ui.ops-ahead.xyz …"
echo "  Ctrl-C to close the tunnel."
echo ""

exec ssh -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -p "$OPS_AHEAD_VM_SSH_PORT" \
  -L 127.0.0.1:80:127.0.0.1:80 \
  -L 127.0.0.1:443:127.0.0.1:443 \
  "${OPS_AHEAD_VM_USER}@${OPS_AHEAD_VM_HOST}"
