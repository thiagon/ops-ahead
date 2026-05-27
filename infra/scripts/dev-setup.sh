#!/usr/bin/env bash
# dev-setup.sh — install kubectl, helm, k3d, yq and add Helm repos
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64\|arm64/arm64/')

step "Docker"
docker info > /dev/null 2>&1 || error "Docker is not running"
info "OK"

step "Tools"

if ! command -v kubectl > /dev/null 2>&1; then
  info "Installing kubectl..."
  LATEST=$(curl -sL https://dl.k8s.io/release/stable.txt)
  curl -sLo "$LOCAL_BIN/kubectl" "https://dl.k8s.io/release/${LATEST}/bin/${OS}/${ARCH}/kubectl"
  chmod +x "$LOCAL_BIN/kubectl"
fi

if ! command -v helm > /dev/null 2>&1; then
  info "Installing Helm..."
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
    | HELM_INSTALL_DIR="$LOCAL_BIN" USE_SUDO=false bash > /dev/null 2>&1
fi

if ! command -v k3d > /dev/null 2>&1; then
  info "Installing k3d..."
  curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh \
    | K3D_INSTALL_DIR="$LOCAL_BIN" USE_SUDO=false bash > /dev/null 2>&1
fi

if ! command -v yq > /dev/null 2>&1; then
  info "Installing yq..."
  curl -sLo "$LOCAL_BIN/yq" "https://github.com/mikefarah/yq/releases/latest/download/yq_${OS}_${ARCH}"
  chmod +x "$LOCAL_BIN/yq"
fi

info "kubectl $(kubectl version --client 2>&1 | head -1)"
info "helm    $(helm version --short)"
info "k3d     $(k3d version | head -1)"
info "yq      $(yq --version)"

step "Helm repos"
helm repo add strimzi              https://strimzi.io/charts/                         2>/dev/null || true
helm repo add altinity             https://docs.altinity.com/clickhouse-operator/     2>/dev/null || true
helm repo add argo                 https://argoproj.github.io/argo-helm               2>/dev/null || true
helm repo add bitnami              https://charts.bitnami.com/bitnami                 2>/dev/null || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo add grafana              https://grafana.github.io/helm-charts              2>/dev/null || true
helm repo add hashicorp            https://helm.releases.hashicorp.com                2>/dev/null || true
helm repo update > /dev/null
info "OK"

step "Done — run: make up"
