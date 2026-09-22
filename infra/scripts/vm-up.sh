#!/usr/bin/env bash
# vm-up.sh — GitOps bootstrap on a VM where k3s is already installed.
#
# Same bootstrap as dev-up.sh minus the k3d cluster lifecycle: k3s owns the
# node, its local-path provisioner owns the storage, and its bundled Traefik
# already serves :80/:443 on the public IP. Everything from "Chart dependencies"
# onwards is plain kubectl/helm and is delegated to dev-up.sh.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

ENV_FILE="$ROOT_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env not found — copy .env.example and fill it in"
set -a; source "$ENV_FILE"; set +a

command -v kubectl > /dev/null 2>&1 || error "kubectl not found — is k3s installed?"
command -v helm    > /dev/null 2>&1 || error "helm not found"
command -v yq      > /dev/null 2>&1 || error "yq not found"
command -v git     > /dev/null 2>&1 || error "git not found"

# helm has no k3s-aware fallback: without this it targets localhost:8080.
if [ -z "${KUBECONFIG:-}" ] && [ -f /etc/rancher/k3s/k3s.yaml ]; then
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
fi

kubectl get nodes > /dev/null 2>&1 || error "cannot reach the cluster — check KUBECONFIG"

step "Node prerequisites"

# dev-up.sh gets this host from k3d's --host-alias. Here the node itself must
# resolve it: the bootstrap drives the Gitea HTTP API and pushes over it, and
# containerd pulls app images from the same host (see registries.yaml).
GITEA_HOST="gitea.ops-ahead.localtest.me"
if ! grep -q "$GITEA_HOST" /etc/hosts; then
  echo "127.0.0.1 $GITEA_HOST" >> /etc/hosts
  info "/etc/hosts → $GITEA_HOST"
else
  info "/etc/hosts already carries $GITEA_HOST"
fi

# k3s reads registry overrides from this path at startup, so a change here only
# takes effect after a restart.
REGISTRIES_DST="/etc/rancher/k3s/registries.yaml"
if ! cmp -s "$(dirname "${BASH_SOURCE[0]}")/registries.yaml" "$REGISTRIES_DST" 2>/dev/null; then
  mkdir -p "$(dirname "$REGISTRIES_DST")"
  cp "$(dirname "${BASH_SOURCE[0]}")/registries.yaml" "$REGISTRIES_DST"
  info "registries.yaml installed — restarting k3s"
  systemctl restart k3s
  for i in $(seq 1 40); do
    kubectl get nodes 2>/dev/null | grep -q " Ready" && break
    sleep 3
  done
else
  info "registries.yaml already current"
fi

SYSCTL_DST="/etc/sysctl.d/60-ops-ahead.conf"
if ! cmp -s "$(dirname "${BASH_SOURCE[0]}")/sysctl.conf" "$SYSCTL_DST" 2>/dev/null; then
  cp "$(dirname "${BASH_SOURCE[0]}")/sysctl.conf" "$SYSCTL_DST"
  sysctl -q -p "$SYSCTL_DST"
  info "sysctl.conf installed → $SYSCTL_DST"
else
  info "sysctl.conf already current"
fi

mkdir -p "$ROOT_DIR/.data"

# Hand off to the shared bootstrap. CLUSTER_EXISTS=skip tells dev-up.sh the node
# is not k3d's to manage.
step "Delegating to the shared bootstrap"
VM_MODE=1 exec bash "$(dirname "${BASH_SOURCE[0]}")/dev-up.sh"
