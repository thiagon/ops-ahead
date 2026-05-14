#!/usr/bin/env bash
# =============================================================================
# dev-up.sh — subir os serviços (equivalente a docker compose up)
# Pré-requisito: ./scripts/dev-setup.sh já executado
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
export PATH="$HOME/.local/bin:$PATH"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# ─── Pré-condições ────────────────────────────────────────────────────────────
docker info > /dev/null 2>&1          || error "Docker não está rodando."
command -v kubectl > /dev/null 2>&1   || error "kubectl não encontrado — rode dev-setup.sh primeiro."
command -v helm    > /dev/null 2>&1   || error "helm não encontrado — rode dev-setup.sh primeiro."
command -v k3d     > /dev/null 2>&1   || error "k3d não encontrado — rode dev-setup.sh primeiro."
cd "$ROOT_DIR"

# ─── Cluster ──────────────────────────────────────────────────────────────────
step "Cluster k3d"
if k3d cluster list 2>/dev/null | grep -q "^ops-ahead"; then
  info "Cluster já existe"
else
  info "Criando cluster 'ops-ahead'..."
  k3d cluster create ops-ahead \
    --agents 1 \
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer" \
    --wait
fi
kubectl get nodes

# ─── Dependências dos charts ──────────────────────────────────────────────────
step "Dependências dos charts"
for chart in data ml agent ui infra; do
  helm dependency build "./infra/charts/$chart" > /dev/null 2>&1 || \
  helm dependency update "./infra/charts/$chart" > /dev/null
  info "charts/$chart OK"
done

# ─── Charts ───────────────────────────────────────────────────────────────────
step "Instalando / atualizando charts"
OPTS="--wait --timeout 8m"

helm upgrade --install ops-ahead-data  ./infra/charts/data  -n data  --create-namespace -f infra/charts/data/values.dev.yaml  $OPTS
info "ns:data"
helm upgrade --install ops-ahead-ml    ./infra/charts/ml    -n ml    --create-namespace -f infra/charts/ml/values.dev.yaml    $OPTS
info "ns:ml"
helm upgrade --install ops-ahead-agent ./infra/charts/agent -n agent --create-namespace -f infra/charts/agent/values.dev.yaml $OPTS
info "ns:agent"
helm upgrade --install ops-ahead-ui    ./infra/charts/ui    -n ui    --create-namespace -f infra/charts/ui/values.dev.yaml    $OPTS
info "ns:ui"
helm upgrade --install ops-ahead-infra ./infra/charts/infra -n infra --create-namespace -f infra/charts/infra/values.dev.yaml $OPTS
info "ns:infra"

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
info "loki"

helm upgrade --install ops-ahead-promtail grafana/promtail -n infra \
  --set "config.clients[0].url=http://ops-ahead-loki-gateway.infra.svc.cluster.local/loki/api/v1/push" \
  --wait --timeout 3m
info "promtail"

# ─── Finalizando ──────────────────────────────────────────────────────────────
kubectl label namespace data ml agent ui infra ops-ahead/monitor=true --overwrite > /dev/null
kubectl apply -f infra/overlays/dev/ingresses.yaml > /dev/null

step "Pronto"
echo ""
echo "  ArgoCD          →  http://argocd.ops-ahead.local"
echo "  Grafana         →  http://grafana.ops-ahead.local       admin / ops-ahead-dev"
echo "  Prometheus      →  http://prometheus.ops-ahead.local"
echo "  MLflow          →  http://mlflow.ops-ahead.local"
echo "  MinIO           →  http://minio.ops-ahead.local          minioadmin / minioadmin"
echo "  Argo Workflows  →  http://argo-workflows.ops-ahead.local"
echo "  LiteLLM         →  http://litellm.ops-ahead.local"
echo "  Gateway         →  http://gateway.ops-ahead.local"
echo "  UI              →  http://ui.ops-ahead.local"
echo ""
