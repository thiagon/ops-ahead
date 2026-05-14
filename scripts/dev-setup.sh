#!/usr/bin/env bash
# =============================================================================
# dev-setup.sh — preparar a máquina (rodar uma vez)
# Instala kubectl / helm / k3d, cria o cluster e configura /etc/hosts.
# Requisito: Docker instalado e rodando
# =============================================================================
set -euo pipefail

DOMAIN="ops-ahead.local"
LOCAL_BIN="$HOME/.local/bin"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# ─── Docker ───────────────────────────────────────────────────────────────────
step "Docker"
docker info > /dev/null 2>&1 || error "Docker não está rodando."
info "OK"

# ─── Ferramentas ──────────────────────────────────────────────────────────────
step "Ferramentas"
mkdir -p "$LOCAL_BIN"
export PATH="$LOCAL_BIN:$PATH"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64\|arm64/arm64/')

if ! command -v kubectl > /dev/null 2>&1; then
  info "Instalando kubectl..."
  LATEST=$(curl -sL https://dl.k8s.io/release/stable.txt)
  curl -sLo "$LOCAL_BIN/kubectl" "https://dl.k8s.io/release/${LATEST}/bin/${OS}/${ARCH}/kubectl"
  chmod +x "$LOCAL_BIN/kubectl"
fi

if ! command -v helm > /dev/null 2>&1; then
  info "Instalando Helm..."
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
    | HELM_INSTALL_DIR="$LOCAL_BIN" USE_SUDO=false bash > /dev/null 2>&1
fi

if ! command -v k3d > /dev/null 2>&1; then
  info "Instalando k3d..."
  curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh \
    | K3D_INSTALL_DIR="$LOCAL_BIN" USE_SUDO=false bash > /dev/null 2>&1
fi

info "kubectl $(kubectl version --client 2>&1 | head -1)"
info "helm    $(helm version --short)"
info "k3d     $(k3d version | head -1)"

# ─── Helm repos ───────────────────────────────────────────────────────────────
step "Helm repos"
helm repo add strimzi              https://strimzi.io/charts/                         2>/dev/null || true
helm repo add altinity             https://docs.altinity.com/clickhouse-operator/     2>/dev/null || true
helm repo add argo                 https://argoproj.github.io/argo-helm               2>/dev/null || true
helm repo add bitnami              https://charts.bitnami.com/bitnami                 2>/dev/null || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo add grafana              https://grafana.github.io/helm-charts              2>/dev/null || true
helm repo update > /dev/null
info "OK"

# ─── /etc/hosts ───────────────────────────────────────────────────────────────
step "/etc/hosts"
SUBDOMAINS=(argocd grafana prometheus mlflow minio argo-workflows litellm gateway ui)

MISSING=()
for sub in "${SUBDOMAINS[@]}"; do
  grep -q "${sub}.${DOMAIN}" /etc/hosts 2>/dev/null || MISSING+=("${sub}.${DOMAIN}")
done

if [ ${#MISSING[@]} -eq 0 ]; then
  info "Já configurado"
else
  ENTRIES=$(printf "127.0.0.1 %s\n" "${MISSING[@]}")
  if [ -w /etc/hosts ]; then
    echo "$ENTRIES" >> /etc/hosts
    info "Atualizado"
  else
    warn "Adicione manualmente ao /etc/hosts (ou rode com sudo):"
    echo ""
    echo "$ENTRIES"
    echo ""
    warn "Linux/Mac:  echo '$ENTRIES' | sudo tee -a /etc/hosts"
    warn "Windows:    C:\\Windows\\System32\\drivers\\etc\\hosts"
  fi
fi

step "Pronto — rode: ./scripts/dev-up.sh para subir o ambiente"
