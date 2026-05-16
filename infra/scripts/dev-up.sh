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

# Cria (ou atualiza) um k8s Secret de forma idempotente.
# Uso: ksecret <nome> <namespace> --from-literal=KEY=VALUE ...
ksecret() {
  local name="$1" ns="$2"; shift 2
  kubectl create secret generic "$name" "$@" \
    -n "$ns" --dry-run=client -o yaml | kubectl apply -f - > /dev/null
  info "secret $name → ns:$ns"
}

# Lê os namespaces declarados em namespaces.yaml (fonte única de verdade).
namespaces_from_yaml() {
  grep "^  name:" infra/apps/namespaces.yaml | awk '{print $2}'
}

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
: "${GITEA_ADMIN_PASSWORD:?'Defina GITEA_ADMIN_PASSWORD no .env'}"
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
    --port "80:80@loadbalancer" \
    --port "443:443@loadbalancer" \
    --wait
fi
kubectl get nodes

# ─── Dependências dos charts (auto-detectadas pelo Chart.yaml) ───────────────
step "Dependências dos charts"
for chart_dir in infra/charts/*/; do
  grep -q "^dependencies:" "${chart_dir}Chart.yaml" 2>/dev/null || continue
  helm dependency build "./$chart_dir" > /dev/null 2>&1 || \
  helm dependency update "./$chart_dir" > /dev/null
  info "$(basename "$chart_dir") OK"
done

# ─── Bootstrap: ArgoCD + Vault + Gitea ───────────────────────────────────────
# Instalação manual dos 3 serviços de plataforma — precisam existir antes do
# GitOps entrar em ação. Após o root-app ser aplicado, infra-argocd/vault/gitea
# (wave 0-2) assumem a gestão contínua desses charts.
step "Bootstrap ArgoCD + Vault + Gitea"
kubectl create namespace infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# argocd-secret: SÓ server.secretkey. SEM admin.password e SEM passwordMtime —
# qualquer um dos dois confunde o ArgoCD quando o outro não existe.
# Resultado: ArgoCD gera tudo do zero e cria argocd-initial-admin-secret.
kubectl delete secret argocd-secret -n infra --ignore-not-found > /dev/null 2>&1

ARGOCD_SERVER_SECRETKEY=$(openssl rand -base64 32)
kubectl create secret generic argocd-secret \
  --from-literal=server.secretkey="${ARGOCD_SERVER_SECRETKEY}" \
  -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# grafana-secret: lido pelo grafana via admin.existingSecret
kubectl create secret generic grafana-secret \
  --from-literal=admin-user="admin" \
  --from-literal=admin-password="${GRAFANA_ADMIN_PASSWORD}" \
  -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

# gitea-admin-secret: lido pelo Gitea via gitea.admin.existingSecret
kubectl create secret generic gitea-admin-secret \
  --from-literal=username="ops-ahead" \
  --from-literal=password="${GITEA_ADMIN_PASSWORD}" \
  -n infra --dry-run=client -o yaml | kubectl apply -f - > /dev/null

helm upgrade --install infra-argocd ./infra/charts/infra-argocd \
  -n infra \
  -f infra/charts/infra-argocd/values.yaml \
  -f infra/charts/infra-argocd/values-dev.yaml \
  --wait --timeout 10m
info "ArgoCD pronto"

# Vault dev token via --set (não fica em git)
helm upgrade --install infra-vault ./infra/charts/infra-vault \
  -n infra \
  -f infra/charts/infra-vault/values.yaml \
  -f infra/charts/infra-vault/values-dev.yaml \
  --set vault.server.dev.devRootToken="${VAULT_TOKEN}" \
  --wait --timeout 5m
info "Vault pronto"

helm upgrade --install infra-gitea ./infra/charts/infra-gitea \
  -n infra \
  -f infra/charts/infra-gitea/values.yaml \
  -f infra/charts/infra-gitea/values-dev.yaml \
  --wait --timeout 5m
info "Gitea pronto"

# ─── Gitea: espelho do working dir pro ArgoCD ler ────────────────────────────
# ArgoCD é pull-based: precisa de uma URL Git pra clonar. Em dev usamos Gitea
# local em vez do GitHub pra evitar push remoto a cada iteração.
step "Push do working dir pro Gitea local"

GITEA_EXTERNAL="http://gitea.ops-ahead.localtest.me"
GITEA_INTERNAL="http://infra-gitea-http.infra.svc.cluster.local:3000"
GITEA_REPO_URL="${GITEA_INTERNAL}/ops-ahead/ops-ahead.git"

# Cria a ingress do Gitea imediatamente — o root-app a recria depois (idempotente)
# Sem isso, gitea.ops-ahead.localtest.me dá 404 (root-app só roda depois do push).
kubectl apply -f - > /dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: gitea
  namespace: infra
  annotations:
    traefik.ingress.kubernetes.io/router.entrypoints: web
spec:
  ingressClassName: traefik
  rules:
    - host: gitea.ops-ahead.localtest.me
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: infra-gitea-http
                port:
                  number: 3000
EOF

# Espera Gitea API responder
for i in {1..30}; do
  curl -sf "${GITEA_EXTERNAL}/api/v1/version" > /dev/null 2>&1 && break
  sleep 2
done

# Cria o repo (idempotente — ignora 409 conflict se já existe)
curl -s -X POST -u "ops-ahead:${GITEA_ADMIN_PASSWORD}" \
  -H "Content-Type: application/json" \
  -d '{"name":"ops-ahead","auto_init":false,"private":false}' \
  "${GITEA_EXTERNAL}/api/v1/user/repos" > /dev/null

# Snapshot do working dir (inclui modified + untracked) → push como 'main' no Gitea
# sem mexer em branches locais. Working dir do user fica intocado.
GITEA_PUSH_URL="http://ops-ahead:${GITEA_ADMIN_PASSWORD}@gitea.ops-ahead.localtest.me/ops-ahead/ops-ahead.git"
git add -A
TREE_HASH=$(git write-tree)
git reset > /dev/null 2>&1
COMMIT_HASH=$(git commit-tree "$TREE_HASH" -p HEAD -m "dev: working dir snapshot")
git push -f "${GITEA_PUSH_URL}" "${COMMIT_HASH}:refs/heads/main" > /dev/null 2>&1
info "Working dir snapshot → gitea.ops-ahead.localtest.me/ops-ahead/ops-ahead (branch: main)"

# ─── ArgoCD Repo Secret ──────────────────────────────────────────────────────
# Aponta ArgoCD pro Gitea interno (URL cluster-internal, sem passar pelo ingress)
kubectl create secret generic gitea-repo-secret \
  --from-literal=type=git \
  --from-literal=url="${GITEA_REPO_URL}" \
  --from-literal=username=ops-ahead \
  --from-literal=password="${GITEA_ADMIN_PASSWORD}" \
  -n infra --dry-run=client -o yaml \
  | kubectl label --local -f - --dry-run=client -o yaml \
      argocd.argoproj.io/secret-type=repository \
  | kubectl apply -f - > /dev/null

# ─── Root Application + Child Applications ───────────────────────────────────
step "Root Application (App-of-Apps)"

# Substitui repoURL do GitHub → Gitea interno. targetRevision: main fica como tá
# (porque pushamos HEAD:main acima). Sem sed na branch.
SED_REPO="s#https://github.com/thiagon/ops-ahead#${GITEA_REPO_URL%.git}#g"

sed "${SED_REPO}" infra/bootstrap/root-app.yaml | kubectl apply -f -
info "ops-ahead-root → ${GITEA_REPO_URL}"

GITHUB_REPO="https://github.com/thiagon/ops-ahead"
for app_yaml in infra/apps/*.yaml; do
  name="$(basename "$app_yaml" .yaml)"
  # namespaces, project e ingresses são recursos K8s — o root-app os sincroniza
  [[ "$name" =~ ^(namespaces|project|ingresses)$ ]] && continue
  # Apps que referenciam o GitHub precisam do sed; apps com chart externo (Helm repo) não
  if grep -q "$GITHUB_REPO" "$app_yaml"; then
    sed "${SED_REPO}" "$app_yaml" | kubectl apply -f - > /dev/null
    info "$name OK"
  else
    kubectl apply -f "$app_yaml" > /dev/null
    info "$name (chart externo)"
  fi
done


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
vault kv put secret/llm-postgres  POSTGRES_USER="agent"  POSTGRES_PASSWORD="${POSTGRES_AGENT_PASSWORD}"  POSTGRES_DB="agent"
vault kv put secret/ml-mlflow     POSTGRES_USER="mlflow" POSTGRES_PASSWORD="${POSTGRES_MLFLOW_PASSWORD}" POSTGRES_DB="mlflow" AWS_ACCESS_KEY_ID="${MINIO_ROOT_USER}" AWS_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}" MLFLOW_S3_ENDPOINT_URL="http://minio.data.svc.cluster.local:9000"
vault kv put secret/llm-litellm   LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY}" ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" OPENAI_API_KEY="${OPENAI_API_KEY}"
vault kv put secret/infra-grafana  ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD}"
vault kv put secret/data-minio     ROOT_USER="${MINIO_ROOT_USER}" ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}"
VAULT_SCRIPT
info "Vault: secret/llm-postgres, secret/ml-mlflow, secret/llm-litellm, secret/infra-grafana, secret/data-minio escritos"

# Pré-cria namespaces antes do ArgoCD sincronizar (necessário para os Secrets abaixo).
# Fonte única: namespaces.yaml — adicionar namespace lá é suficiente.
while IFS= read -r ns; do
  [[ "$ns" == "infra" ]] && continue   # infra já existe desde o bootstrap
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - > /dev/null
done < <(namespaces_from_yaml)

# ─── Secrets k8s ──────────────────────────────────────────────────────────────
# Criados aqui (não nos charts) — ArgoCD recomenda popular secrets
# diretamente no cluster: https://argo-cd.readthedocs.io/en/stable/operator-manual/secret-management/
# Para adicionar um novo serviço: ksecret <nome> <namespace> --from-literal=KEY=VALUE ...

ksecret minio-secret          data  --from-literal=rootUser="${MINIO_ROOT_USER}"           --from-literal=rootPassword="${MINIO_ROOT_PASSWORD}"
ksecret llm-postgres-secret   llm   --from-literal=postgres-password="${POSTGRES_AGENT_PASSWORD}"  --from-literal=password="${POSTGRES_AGENT_PASSWORD}"
ksecret litellm-secret        llm   --from-literal=ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"  --from-literal=OPENAI_API_KEY="${OPENAI_API_KEY}"  --from-literal=LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY}"
ksecret mlflow-postgres-secret ml   --from-literal=postgres-password="${POSTGRES_MLFLOW_PASSWORD}" --from-literal=password="${POSTGRES_MLFLOW_PASSWORD}"
ksecret mlflow-secret          ml   --from-literal=POSTGRES_USER="mlflow"  --from-literal=POSTGRES_PASSWORD="${POSTGRES_MLFLOW_PASSWORD}"  --from-literal=POSTGRES_DB="mlflow"  --from-literal=AWS_ACCESS_KEY_ID="${MINIO_ROOT_USER}"  --from-literal=AWS_SECRET_ACCESS_KEY="${MINIO_ROOT_PASSWORD}"  --from-literal=MLFLOW_S3_ENDPOINT_URL="http://minio.data.svc.cluster.local:9000"

# ─── Labels ───────────────────────────────────────────────────────────────────
# Derivados de namespaces.yaml — adicionar namespace lá aplica o label automaticamente.
while IFS= read -r ns; do
  kubectl get namespace "$ns" > /dev/null 2>&1 && \
    kubectl label namespace "$ns" ops-ahead/monitor=true --overwrite > /dev/null || \
    warn "namespace $ns ainda não existe — label será aplicado quando o ArgoCD criar"
done < <(namespaces_from_yaml)

# ─── Pronto ───────────────────────────────────────────────────────────────────
step "Pronto"

# Lê senha initial-admin que ArgoCD auto-gerou e persiste em .env.local
# (gitignored). Reusa entre runs no mesmo cluster.
sleep 3
ARGOCD_INITIAL_PASS=""
if kubectl -n infra get secret argocd-initial-admin-secret > /dev/null 2>&1; then
  ARGOCD_INITIAL_PASS=$(kubectl -n infra get secret argocd-initial-admin-secret \
    -o jsonpath='{.data.password}' | base64 -d)

  # Escreve em .env.local (sobrescreve a cada make up)
  cat > "$ROOT_DIR/.env.local" <<EOF
# Credenciais geradas dinamicamente pelo make up — NÃO commitar
# Atualizadas a cada nova subida de cluster.
ARGOCD_ADMIN_USER=admin
ARGOCD_ADMIN_PASSWORD=${ARGOCD_INITIAL_PASS}
EOF
  info ".env.local atualizado com a senha do ArgoCD"
fi

echo ""
echo "  ArgoCD          →  http://argocd.ops-ahead.localtest.me        (credenciais em .env.local)"
echo "  Gitea (local)   →  http://gitea.ops-ahead.localtest.me        (user: ops-ahead | senha em .env)"
echo "  Vault           →  http://vault.ops-ahead.localtest.me        (credenciais em .env)"
echo "  Grafana         →  http://grafana.ops-ahead.localtest.me      (credenciais em .env)"
echo "  MinIO           →  http://minio.ops-ahead.localtest.me        (credenciais em .env)"
echo "  Prometheus      →  http://prometheus.ops-ahead.localtest.me"
echo "  MLflow          →  http://mlflow.ops-ahead.localtest.me"
echo "  Argo Workflows  →  http://argo-workflows.ops-ahead.localtest.me"
echo "  LiteLLM         →  http://litellm.ops-ahead.localtest.me"
echo "  Gateway         →  http://gateway.ops-ahead.localtest.me"
echo "  UI              →  http://ui.ops-ahead.localtest.me"
echo ""
echo "  Iterar:  edite os charts/manifests e rode  make sync"
echo ""
