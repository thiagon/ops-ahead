#!/usr/bin/env bash
# =============================================================================
# dev-up.sh — bootstrap GitOps do ambiente de dev
#
# Fluxo:
#   1. Cria cluster k3d
#   2. Instala só o ArgoCD (bootstrap)
#   3. Aplica root-app → ArgoCD sincroniza tudo via infra/apps/dev
#   4. Aguarda todos os Applications ficarem Healthy
#   5. Bootstrap do Vault (exec, não pode ser GitOps)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
export PATH="$HOME/.local/bin:$PATH"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}▶${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*"; exit 1; }
step()  { echo -e "\n${GREEN}━━━ $* ━━━${NC}"; }

# ─── Credenciais do .env ──────────────────────────────────────────────────────
ENV_FILE="$ROOT_DIR/.env"
[ -f "$ENV_FILE" ] || error ".env não encontrado — rode: make setup"
set -a; source "$ENV_FILE"; set +a

: "${VAULT_TOKEN:?'VAULT_TOKEN não definido no .env'}"

# Credenciais por serviço — obrigatórias no .env (copie de .env.example)
: "${POSTGRES_AGENT_PASSWORD:?'Defina POSTGRES_AGENT_PASSWORD no .env'}"
: "${POSTGRES_MLFLOW_PASSWORD:?'Defina POSTGRES_MLFLOW_PASSWORD no .env'}"
: "${MINIO_ROOT_USER:?'Defina MINIO_ROOT_USER no .env'}"
: "${MINIO_ROOT_PASSWORD:?'Defina MINIO_ROOT_PASSWORD no .env'}"
: "${LITELLM_MASTER_KEY:?'Defina LITELLM_MASTER_KEY no .env'}"
: "${GRAFANA_ADMIN_PASSWORD:?'Defina GRAFANA_ADMIN_PASSWORD no .env'}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OPENAI_API_KEY="${OPENAI_API_KEY:-}"

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

# ─── Bootstrap: ArgoCD ────────────────────────────────────────────────────────
# Único helm install manual — ArgoCD precisa existir antes de gerenciar qualquer coisa.
# Após isso, app-infra.yaml (wave 0) assume a gestão do chart infra completo.
step "Bootstrap ArgoCD"
kubectl create namespace infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# Grafana admin secret precisa existir antes do prometheus chart sincronizar
kubectl create secret generic grafana-secret \
  --from-literal=admin-user="admin" \
  --from-literal=admin-password="${GRAFANA_ADMIN_PASSWORD}" \
  -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# Vault dev token passado via --set para não ficar em git
helm upgrade --install ops-ahead-infra ./infra/charts/infra \
  -n infra \
  -f infra/charts/infra/values.yaml \
  -f infra/charts/infra/values-dev.yaml \
  --set vault.server.dev.devRootToken="${VAULT_TOKEN}" \
  --wait --timeout 8m
info "ArgoCD pronto"

# ─── Root Application ─────────────────────────────────────────────────────────
step "Root Application (App-of-Apps)"
kubectl apply -f infra/bootstrap/root-app.yaml
info "ops-ahead-root criado — ArgoCD vai sincronizar o overlay"


# ─── Bootstrap Vault ──────────────────────────────────────────────────────────
step "Bootstrap Vault"
kubectl wait pod -l app.kubernetes.io/name=vault -n infra \
  --for=condition=Ready --timeout=120s > /dev/null

VAULT_POD=$(kubectl get pod -n infra -l app.kubernetes.io/name=vault \
  -o jsonpath='{.items[0].metadata.name}')

# Heredoc evita expor VAULT_TOKEN como argumento de processo (visível em ps/audit)
kubectl exec -i -n infra "$VAULT_POD" -- sh << VAULT_SCRIPT
export VAULT_TOKEN='${VAULT_TOKEN}'
vault auth enable kubernetes 2>/dev/null || true
vault write auth/kubernetes/config kubernetes_host="https://kubernetes.default.svc" > /dev/null
vault kv put secret/agent   POSTGRES_USER="agent"  POSTGRES_PASSWORD="${POSTGRES_AGENT_PASSWORD}"  POSTGRES_DB="agent"
vault kv put secret/mlflow  POSTGRES_USER="mlflow" POSTGRES_PASSWORD="${POSTGRES_MLFLOW_PASSWORD}" POSTGRES_DB="mlflow" AWS_ACCESS_KEY_ID="${MINIO_ROOT_USER}" AWS_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}" MLFLOW_S3_ENDPOINT_URL="http://minio.data.svc.cluster.local:9000"
vault kv put secret/litellm LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY}" ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" OPENAI_API_KEY="${OPENAI_API_KEY}"
vault kv put secret/grafana ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD}"
vault kv put secret/minio   ROOT_USER="${MINIO_ROOT_USER}" ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}"
VAULT_SCRIPT
info "Vault: secret/agent, secret/mlflow, secret/litellm, secret/grafana, secret/minio escritos"

# Cria Secrets k8s antes do ArgoCD sincronizar — ignoreDifferences nos Applications
# impede o selfHeal de sobrescrever com os PLACEHOLDERs do chart.
kubectl create namespace agent --dry-run=client -o yaml | kubectl apply -f - > /dev/null
kubectl create namespace ml   --dry-run=client -o yaml | kubectl apply -f - > /dev/null
kubectl create namespace data --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# minio (envFrom no StatefulSet e bootstrap Job)
kubectl create secret generic minio-secret \
  --from-literal=rootUser="${MINIO_ROOT_USER}" \
  --from-literal=rootPassword="${MINIO_ROOT_PASSWORD}" \
  -n data --dry-run=client -o yaml | kubectl apply -f - > /dev/null


# Secrets criados aqui (não nos charts) — ArgoCD recomenda popular secrets
# direto no cluster destino: https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/

# agent-postgres (Bitnami existingSecret)
kubectl create secret generic agent-postgres-secret \
  --from-literal=postgres-password="${POSTGRES_AGENT_PASSWORD}" \
  --from-literal=password="${POSTGRES_AGENT_PASSWORD}" \
  -n agent --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# mlflow-postgres (Bitnami existingSecret)
kubectl create secret generic mlflow-postgres-secret \
  --from-literal=postgres-password="${POSTGRES_MLFLOW_PASSWORD}" \
  --from-literal=password="${POSTGRES_MLFLOW_PASSWORD}" \
  -n ml --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# litellm (envFrom no Deployment)
kubectl create secret generic litellm-secret \
  --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY}" \
  --from-literal=LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY}" \
  -n agent --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# mlflow (envFrom no Deployment)
kubectl create secret generic mlflow-secret \
  --from-literal=POSTGRES_USER="mlflow" \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_MLFLOW_PASSWORD}" \
  --from-literal=POSTGRES_DB="mlflow" \
  --from-literal=AWS_ACCESS_KEY_ID="${MINIO_ROOT_USER}" \
  --from-literal=AWS_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}" \
  --from-literal=MLFLOW_S3_ENDPOINT_URL="http://minio.data.svc.cluster.local:9000" \
  -n ml --dry-run=client -o yaml | kubectl apply -f - > /dev/null

info "Secrets criados: minio-secret, grafana-secret, agent-postgres-secret, mlflow-postgres-secret, litellm-secret, mlflow-secret"

# ─── Labels ───────────────────────────────────────────────────────────────────
for ns in data ml agent ui infra; do
  kubectl get namespace "$ns" > /dev/null 2>&1 && \
    kubectl label namespace "$ns" ops-ahead/monitor=true --overwrite > /dev/null || \
    warn "namespace $ns ainda não existe — label será aplicado quando o ArgoCD criar"
done

# ─── Pronto ───────────────────────────────────────────────────────────────────
step "Pronto"
echo ""
echo "  Vault           →  http://vault.ops-ahead.localtest.me        (credenciais em .env)"
echo "  ArgoCD          →  http://argocd.ops-ahead.localtest.me       (credenciais em .env)"
echo "  Grafana         →  http://grafana.ops-ahead.localtest.me      (credenciais em .env)"
echo "  MinIO           →  http://minio.ops-ahead.localtest.me        (credenciais em .env)"
echo "  Prometheus      →  http://prometheus.ops-ahead.localtest.me"
echo "  MLflow          →  http://mlflow.ops-ahead.localtest.me"
echo "  Argo Workflows  →  http://argo-workflows.ops-ahead.localtest.me"
echo "  LiteLLM         →  http://litellm.ops-ahead.localtest.me"
echo "  Gateway         →  http://gateway.ops-ahead.localtest.me"
echo "  UI              →  http://ui.ops-ahead.localtest.me"
echo ""
