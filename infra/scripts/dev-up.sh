#!/usr/bin/env bash
# =============================================================================
# dev-up.sh — subir o ambiente (equivalente a docker compose up)
# Pré-requisito: make setup já executado
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
export PATH="$HOME/.local/bin:$PATH"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# ─── Credenciais do .env ──────────────────────────────────────────────────────
ENV_FILE="$ROOT_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env não encontrado em $ROOT_DIR — copie .env.example e preencha"
set -a; source "$ENV_FILE"; set +a

: "${DEV_USER:?'DEV_USER não definido no .env'}"
: "${DEV_PASSWORD:?'DEV_PASSWORD não definido no .env'}"
: "${VAULT_TOKEN:?'VAULT_TOKEN não definido no .env'}"

# ArgoCD exige bcrypt da senha
ARGOCD_HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw('${DEV_PASSWORD}'.encode(), bcrypt.gensalt(rounds=10)).decode())")

# ─── Pré-condições ────────────────────────────────────────────────────────────
docker info > /dev/null 2>&1        || error "Docker não está rodando."
command -v kubectl > /dev/null 2>&1 || error "kubectl não encontrado — rode: make setup"
command -v helm    > /dev/null 2>&1 || error "helm não encontrado — rode: make setup"
command -v k3d     > /dev/null 2>&1 || error "k3d não encontrado — rode: make setup"

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

helm upgrade --install ops-ahead-data ./infra/charts/data -n data --create-namespace \
  -f infra/charts/data/values.dev.yaml \
  --set "minio.credentials.rootUser=${DEV_USER}" \
  --set "minio.credentials.rootPassword=${DEV_PASSWORD}" \
  $OPTS
info "ns:data"

helm upgrade --install ops-ahead-ml    ./infra/charts/ml    -n ml    --create-namespace -f infra/charts/ml/values.dev.yaml    $OPTS
info "ns:ml"
helm upgrade --install ops-ahead-agent ./infra/charts/agent -n agent --create-namespace -f infra/charts/agent/values.dev.yaml $OPTS
info "ns:agent"
helm upgrade --install ops-ahead-ui    ./infra/charts/ui    -n ui    --create-namespace -f infra/charts/ui/values.dev.yaml    $OPTS
info "ns:ui"

helm upgrade --install ops-ahead-infra ./infra/charts/infra -n infra --create-namespace \
  -f infra/charts/infra/values.dev.yaml \
  --set "argo-cd.configs.secret.argocdServerAdminPassword=${ARGOCD_HASH}" \
  --set "argo-cd.configs.secret.argocdServerAdminPasswordMtime=2026-01-01T00:00:00Z" \
  --set "argo-cd.configs.secret.argocdServerAdminUsername=${DEV_USER}" \
  --set "kube-prometheus-stack.grafana.adminUser=${DEV_USER}" \
  --set "kube-prometheus-stack.grafana.adminPassword=${DEV_PASSWORD}" \
  --set "vault.server.dev.devRootToken=${VAULT_TOKEN}" \
  $OPTS
info "ns:infra"

# ─── Bootstrap Vault ──────────────────────────────────────────────────────────
step "Bootstrap Vault"
kubectl wait pod -l app.kubernetes.io/name=vault -n infra \
  --for=condition=Ready --timeout=120s > /dev/null

VAULT_POD=$(kubectl get pod -n infra -l app.kubernetes.io/name=vault \
  -o jsonpath='{.items[0].metadata.name}')

# KV v2 já habilitado por padrão no dev mode — escreve credenciais
kubectl exec -n infra "$VAULT_POD" -- \
  env VAULT_TOKEN="${VAULT_TOKEN}" \
  vault kv put secret/ops-ahead \
    user="${DEV_USER}" \
    password="${DEV_PASSWORD}" > /dev/null

# Habilita autenticação Kubernetes para injeção futura nos pods
kubectl exec -n infra "$VAULT_POD" -- \
  env VAULT_TOKEN="${VAULT_TOKEN}" \
  vault auth enable kubernetes 2>/dev/null || true

kubectl exec -n infra "$VAULT_POD" -- \
  env VAULT_TOKEN="${VAULT_TOKEN}" \
  vault write auth/kubernetes/config \
    kubernetes_host="https://kubernetes.default.svc" > /dev/null

info "secret/ops-ahead escrito — Vault pronto"

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
echo "  Vault           →  http://vault.ops-ahead.localtest.me        token: ${VAULT_TOKEN}"
echo "  ArgoCD          →  http://argocd.ops-ahead.localtest.me       ${DEV_USER} / ${DEV_PASSWORD}"
echo "  Grafana         →  http://grafana.ops-ahead.localtest.me      ${DEV_USER} / ${DEV_PASSWORD}"
echo "  MinIO           →  http://minio.ops-ahead.localtest.me        ${DEV_USER} / ${DEV_PASSWORD}"
echo "  Prometheus      →  http://prometheus.ops-ahead.localtest.me"
echo "  MLflow          →  http://mlflow.ops-ahead.localtest.me"
echo "  Argo Workflows  →  http://argo-workflows.ops-ahead.localtest.me"
echo "  LiteLLM         →  http://litellm.ops-ahead.localtest.me"
echo "  Gateway         →  http://gateway.ops-ahead.localtest.me"
echo "  UI              →  http://ui.ops-ahead.localtest.me"
echo ""
