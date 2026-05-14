# Ops Ahead — AIOps Locaweb

Sistema de AIOps para predição e explicação de padrões de incidentes de TI sobre o dataset ITSM da Locaweb. Antecipa volume de incidentes (D+1 e D+7), identifica risco de violação de OLA e apoia decisões operacionais.

**Projeto:** FIAP Enterprise Challenge 2026

---

## Índice

- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Setup local — dados e modelos](#setup-local--dados-e-modelos)
- [Setup local — infraestrutura K8s](#setup-local--infraestrutura-k8s)
- [Sprints](#sprints)

---

## Visão geral

O Ops Ahead é um sistema AIOps modular em quatro camadas:

```
Dados → Modelos → Copiloto IA → Interfaces
```

| Camada | Função |
|--------|--------|
| **Dados** | Ingestão de incidentes via Kafka, armazenamento no MinIO (Iceberg) e ClickHouse |
| **Modelos** | Forecasting de volume (D+1/D+7), scoring de risco OLA, MLflow para tracking |
| **Copiloto IA** | Agente LLM com ferramentas para recomendações e ações (LiteLLM + pgvector) |
| **Interfaces** | Gateway + UI web para operadores |

---

## Arquitetura

```
ns: data          ns: ml            ns: agent         ns: ui
┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐
│  Kafka   │─────▶│  MLflow  │◀────▶│ LiteLLM  │◀────▶│ Gateway  │
│  MinIO   │      │  Redis   │      │ Postgres  │      │    UI    │
│ClickHouse│      │ Postgres │      │ pgvector  │      └──────────┘
│  Argo WF │      └──────────┘      └──────────┘
└──────────┘

ns: infra
┌──────────────────────────────────────────┐
│  ArgoCD  │  Prometheus  │  Loki  │ Grafana │
└──────────────────────────────────────────┘
```

Toda a stack roda em Kubernetes, gerenciada via **Helm charts por namespace** com overlay `dev` (1 réplica, sem TLS, recursos reduzidos) e overlay `prod` (HPA, TLS, Vault).

---

## Estrutura do repositório

```
assets/
  incidents.csv             # dataset processado (27 colunas, snake_case)
docs/
  context/                  # dicionário de dados
  sprints/                  # requisitos por sprint
infra/
  charts/
    data/                   # Kafka (Strimzi), MinIO, ClickHouse (Altinity), Argo Workflows
    ml/                     # MLflow + Postgres, Redis
    agent/                  # Postgres + pgvector, LiteLLM proxy
    ui/                     # gateway (stub), ui (stub)
    infra/                  # ArgoCD, Prometheus, Loki, Grafana
  overlays/
    dev/                    # kustomization com values.dev.yaml por chart
    prod/                   # kustomization de produção
scripts/
  prepare_dataset.py        # pipeline Excel → CSV
```

---

## Setup local — dados e modelos

**Pré-requisito:** Python 3.12+

```bash
# instalar dependências
uv sync

# dataset já processado em assets/incidents.csv
# para reprocessar a partir do Excel original:
python scripts/prepare_dataset.py
```

**Campos principais do dataset:**

| Campo | Descrição |
|-------|-----------|
| `prioridade_codigo` | 1=Crítico, 2=Alto, 3=Médio, 4=Baixo, 5=Muito Baixo |
| `aberto_em` | Datetime de abertura do incidente |
| `duracao_segundos` | Tempo de resolução em segundos |
| `entrou_kpi` | 1 se contado no KPI |
| `kpi_violado` | 1 se OLA foi violado |

**Regras de OLA:** P1/P2 ≤ 4h · P3 ≤ 12h · P4 ≤ 24h · P5 ≤ 96h

---

## Setup local — infraestrutura K8s

### Pré-requisitos

| Ferramenta | Versão testada | Finalidade |
|-----------|---------------|-----------|
| Docker Engine | 28.x | base para os containers do cluster |
| kubectl | v1.36+ | gerenciar o cluster |
| Helm | v3.20+ | instalar os charts |
| k3d | v5.8+ | criar cluster k3s local dentro do Docker |

> **Espaço em disco:** reserve ao menos **30 GB livres** antes de iniciar. As imagens dos operators (Strimzi, Altinity, Argo) somam ~8 GB no primeiro pull.

### 1. Instalar as ferramentas (uma vez)

```bash
# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl && mv kubectl ~/.local/bin/

# Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
  | HELM_INSTALL_DIR=$HOME/.local/bin USE_SUDO=false bash

# k3d
curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh \
  | K3D_INSTALL_DIR=$HOME/.local/bin USE_SUDO=false bash

# adicionar ~/.local/bin ao PATH (colocar também no ~/.bashrc ou ~/.zshrc)
export PATH="$HOME/.local/bin:$PATH"
```

### 2. Criar o cluster local

```bash
k3d cluster create ops-ahead --agents 1 --wait
kubectl cluster-info   # confirmar que está rodando
kubectl get nodes      # deve mostrar server-0 e agent-0 Ready
```

### 3. Adicionar os repositórios Helm

```bash
helm repo add strimzi  https://strimzi.io/charts/
helm repo add altinity https://docs.altinity.com/clickhouse-operator/
helm repo add argo     https://argoproj.github.io/argo-helm
helm repo add bitnami  https://charts.bitnami.com/bitnami
helm repo add grafana  https://grafana.github.io/helm-charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

### 4. Baixar dependências de cada chart

```bash
helm dependency build ./infra/charts/data
helm dependency build ./infra/charts/ml
helm dependency build ./infra/charts/agent
helm dependency build ./infra/charts/infra
```

### 5. Instalar os namespaces em ordem

Sempre instale na ordem abaixo — cada namespace depende do anterior.

```bash
# 1. data — Kafka, MinIO, ClickHouse, Argo Workflows
helm install ops-ahead-data ./infra/charts/data \
  -n data --create-namespace \
  -f infra/charts/data/values.dev.yaml

# 2. ml — MLflow + Postgres, Redis
helm install ops-ahead-ml ./infra/charts/ml \
  -n ml --create-namespace \
  -f infra/charts/ml/values.dev.yaml

# 3. agent — Postgres + pgvector, LiteLLM
helm install ops-ahead-agent ./infra/charts/agent \
  -n agent --create-namespace \
  -f infra/charts/agent/values.dev.yaml

# 4. ui — stubs de gateway e ui
helm install ops-ahead-ui ./infra/charts/ui \
  -n ui --create-namespace \
  -f infra/charts/ui/values.dev.yaml

# 5. infra — ArgoCD, Prometheus, Loki, Grafana
helm install ops-ahead-infra ./infra/charts/infra \
  -n infra --create-namespace \
  -f infra/charts/infra/values.dev.yaml
```

### 6. Verificar saúde

```bash
# aguardar todos os pods ficarem Ready
kubectl wait --for=condition=Ready pod --all -n data    --timeout=300s
kubectl wait --for=condition=Ready pod --all -n ml      --timeout=300s
kubectl wait --for=condition=Ready pod --all -n agent   --timeout=300s
kubectl wait --for=condition=Ready pod --all -n ui      --timeout=300s
kubectl wait --for=condition=Ready pod --all -n infra   --timeout=300s

# Kafka — tópicos criados pelo Strimzi operator
kubectl get kafkatopics -n data

# MinIO — acessar console
kubectl port-forward svc/minio 9001:9001 -n data
# abrir http://localhost:9001 | usuário: minioadmin | senha: minioadmin

# ClickHouse — testar query
kubectl exec -it -n data \
  $(kubectl get pod -n data -l clickhouse.altinity.com/cluster=ops-ahead -o name | head -1) \
  -- clickhouse-client --query "SELECT 1"

# Argo Workflows — acessar UI
kubectl port-forward svc/ops-ahead-data-argo-workflows-server 2746:2746 -n data
# abrir http://localhost:2746

# MLflow
kubectl port-forward svc/mlflow 5000:5000 -n ml
# abrir http://localhost:5000
```

### Remover o cluster

```bash
k3d cluster delete ops-ahead
```

---

## Sprints

| Sprint | Entrega | Status |
|--------|---------|--------|
| Sprint 1 — Ideação | 2026-04-27 | Concluída |
| Sprint 2 — Arquitetura + EDA | 2026-05-24 | Em andamento |
| Sprint 3 — MVP | 2026-08-23 | Planejada |
| Sprint 4 — Final | 2026-09-08 | Planejada |
