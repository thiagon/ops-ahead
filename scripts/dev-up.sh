#!/usr/bin/env bash
# =============================================================================
# dev-up.sh — Ops Ahead local dev setup
# Requisito: Docker instalado e rodando
# Uso: ./scripts/dev-up.sh
# =============================================================================
set -euo pipefail

CLUSTER_NAME="ops-ahead"
DOMAIN="ops-ahead.local"
LOCAL_BIN="$HOME/.local/bin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# ─── 1. Docker ────────────────────────────────────────────────────────────────
step "Verificando Docker"
docker info > /dev/null 2>&1 || error "Docker não está rodando. Inicie o Docker e tente novamente."
info "Docker OK"

# ─── 2. Ferramentas ───────────────────────────────────────────────────────────
step "Verificando ferramentas (kubectl / helm / k3d)"
mkdir -p "$LOCAL_BIN"
export PATH="$LOCAL_BIN:$PATH"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64\|arm64/arm64/')

install_kubectl() {
  info "Instalando kubectl..."
  LATEST=$(curl -sL https://dl.k8s.io/release/stable.txt)
  curl -sLo "$LOCAL_BIN/kubectl" \
    "https://dl.k8s.io/release/${LATEST}/bin/${OS}/${ARCH}/kubectl"
  chmod +x "$LOCAL_BIN/kubectl"
}

install_helm() {
  info "Instalando Helm..."
  curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
    | HELM_INSTALL_DIR="$LOCAL_BIN" USE_SUDO=false bash > /dev/null 2>&1
}

install_k3d() {
  info "Instalando k3d..."
  curl -fsSL https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh \
    | K3D_INSTALL_DIR="$LOCAL_BIN" USE_SUDO=false bash > /dev/null 2>&1
}

command -v kubectl > /dev/null 2>&1 && info "kubectl $(kubectl version --client 2>&1 | head -1)" || install_kubectl
command -v helm    > /dev/null 2>&1 && info "helm $(helm version --short)"                       || install_helm
command -v k3d     > /dev/null 2>&1 && info "k3d $(k3d version | head -1)"                       || install_k3d

# ─── 3. Cluster ───────────────────────────────────────────────────────────────
step "Cluster k3d"
if k3d cluster list 2>/dev/null | grep -q "^${CLUSTER_NAME}"; then
  warn "Cluster '${CLUSTER_NAME}' já existe — pulando criação"
else
  info "Criando cluster '${CLUSTER_NAME}' (porta 80 mapeada para o host)..."
  k3d cluster create "$CLUSTER_NAME" \
    --agents 1 \
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer" \
    --wait
  info "Cluster criado"
fi
kubectl get nodes

# ─── 4. Helm repos ────────────────────────────────────────────────────────────
step "Repositórios Helm"
helm repo add strimzi              https://strimzi.io/charts/                        2>/dev/null || true
helm repo add altinity             https://docs.altinity.com/clickhouse-operator/    2>/dev/null || true
helm repo add argo                 https://argoproj.github.io/argo-helm              2>/dev/null || true
helm repo add bitnami              https://charts.bitnami.com/bitnami                2>/dev/null || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo add grafana              https://grafana.github.io/helm-charts             2>/dev/null || true
helm repo update > /dev/null
info "Repos atualizados"

# ─── 5. Dependências dos charts ───────────────────────────────────────────────
step "Dependências dos charts"
cd "$ROOT_DIR"
for chart in data ml agent infra; do
  info "helm dependency build → charts/$chart"
  helm dependency build "./infra/charts/$chart" > /dev/null 2>&1 || \
  helm dependency update "./infra/charts/$chart" > /dev/null
done

# ─── 6. Instalar charts em ordem ──────────────────────────────────────────────
step "Instalando charts"
OPTS="--wait --timeout 8m"

helm upgrade --install ops-ahead-data ./infra/charts/data \
  -n data --create-namespace -f infra/charts/data/values.dev.yaml $OPTS
info "ns:data instalado"

helm upgrade --install ops-ahead-ml ./infra/charts/ml \
  -n ml --create-namespace -f infra/charts/ml/values.dev.yaml $OPTS
info "ns:ml instalado"

helm upgrade --install ops-ahead-agent ./infra/charts/agent \
  -n agent --create-namespace -f infra/charts/agent/values.dev.yaml $OPTS
info "ns:agent instalado"

helm upgrade --install ops-ahead-ui ./infra/charts/ui \
  -n ui --create-namespace -f infra/charts/ui/values.dev.yaml $OPTS
info "ns:ui instalado"

helm upgrade --install ops-ahead-infra ./infra/charts/infra \
  -n infra --create-namespace -f infra/charts/infra/values.dev.yaml $OPTS
info "ns:infra instalado"

helm upgrade --install ops-ahead-loki grafana/loki -n infra \
  --set deploymentMode=SingleBinary \
  --set loki.useTestSchema=true \
  --set loki.auth_enabled=false \
  --set loki.commonConfig.replication_factor=1 \
  --set loki.storage.type=filesystem \
  --set loki.storage.bucketNames.chunks=chunks \
  --set loki.storage.bucketNames.ruler=ruler \
  --set loki.storage.bucketNames.admin=admin \
  --set singleBinary.replicas=1 \
  --set backend.replicas=0 --set read.replicas=0 --set write.replicas=0 \
  --set chunksCache.enabled=false --set resultsCache.enabled=false \
  --wait --timeout 5m
info "Loki instalado"

helm upgrade --install ops-ahead-promtail grafana/promtail -n infra \
  --set "config.clients[0].url=http://ops-ahead-loki-gateway.infra.svc.cluster.local/loki/api/v1/push" \
  --wait --timeout 3m
info "Promtail instalado"

# ─── 7. Labels dos namespaces ─────────────────────────────────────────────────
kubectl label namespace data ml agent ui infra ops-ahead/monitor=true --overwrite > /dev/null

# ─── 8. Ingress resources ─────────────────────────────────────────────────────
step "Aplicando Ingress resources"
kubectl apply -f infra/overlays/dev/ingresses.yaml
info "Ingress resources aplicados"

# ─── 9. /etc/hosts ────────────────────────────────────────────────────────────
step "Configurando /etc/hosts"

SUBDOMAINS=(
  "argocd" "grafana" "prometheus"
  "mlflow" "minio" "argo-workflows"
  "litellm" "gateway" "ui"
)

MISSING=()
for sub in "${SUBDOMAINS[@]}"; do
  HOST="${sub}.${DOMAIN}"
  grep -q "$HOST" /etc/hosts 2>/dev/null || MISSING+=("$HOST")
done

if [ ${#MISSING[@]} -eq 0 ]; then
  info "/etc/hosts já configurado"
else
  ENTRIES=""
  for host in "${MISSING[@]}"; do
    ENTRIES+="127.0.0.1 ${host}\n"
  done

  if [ -w /etc/hosts ]; then
    printf "$ENTRIES" >> /etc/hosts
    info "/etc/hosts atualizado automaticamente"
  else
    warn "/etc/hosts requer permissão. Adicione manualmente (ou rode com sudo):"
    echo ""
    printf "$ENTRIES"
    echo ""
    warn "Linux/Mac: sudo tee -a /etc/hosts << 'EOF'"
    printf "$ENTRIES"
    echo "EOF"
    warn "Windows: adicionar em C:\\Windows\\System32\\drivers\\etc\\hosts"
  fi
fi

# ─── 10. Resumo ───────────────────────────────────────────────────────────────
step "Pronto"
echo ""
echo "  ArgoCD          →  http://argocd.${DOMAIN}"
echo "  Grafana         →  http://grafana.${DOMAIN}         admin / ops-ahead-dev"
echo "  Prometheus      →  http://prometheus.${DOMAIN}"
echo "  MLflow          →  http://mlflow.${DOMAIN}"
echo "  MinIO           →  http://minio.${DOMAIN}            minioadmin / minioadmin"
echo "  Argo Workflows  →  http://argo-workflows.${DOMAIN}"
echo "  LiteLLM         →  http://litellm.${DOMAIN}"
echo "  Gateway (stub)  →  http://gateway.${DOMAIN}"
echo "  UI (stub)       →  http://ui.${DOMAIN}"
echo ""
info "Para expor externamente: ngrok http 80"
