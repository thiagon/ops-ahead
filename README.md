# Ops Ahead — AIOps Locaweb

Sistema de AIOps para predição e explicação de padrões de incidentes de TI sobre o dataset ITSM da Locaweb. Antecipa volume de incidentes (D+1 e D+7), identifica risco de violação de OLA e apoia decisões operacionais.

**Projeto:** FIAP Enterprise Challenge 2026

---

## Índice

- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Infraestrutura local (K8s)](#infraestrutura-local-k8s)
- [Análise de dados (Python)](#análise-de-dados-python)
- [Sprints](#sprints)

---

## Visão geral

O Ops Ahead é um sistema AIOps modular em quatro camadas:

```
Dados → Modelos → Copiloto IA → Interfaces
```

| Camada | Componentes |
|--------|-------------|
| **Dados** | Kafka (Strimzi), MinIO + Iceberg, ClickHouse (Altinity), Argo Workflows |
| **Modelos** | MLflow tracking, Postgres, Redis |
| **Copiloto IA** | LiteLLM proxy (Claude Sonnet 4.6 + GPT-4.1), Postgres + pgvector |
| **Interfaces** | Gateway + UI (nginx stubs, substituídos nas Sprints 3/4) |
| **Plataforma** | ArgoCD, Prometheus, Grafana, Loki + Promtail |

---

## Arquitetura

```
                        ┌─────────────────────┐
                        │  Traefik (porta 80)  │  ← único ponto de entrada
                        └──────────┬──────────┘
               ┌──────────┬────────┼────────┬──────────┐
            ns:ui       ns:agent  ns:ml   ns:data    ns:infra
         ┌────────┐   ┌────────┐ ┌──────┐ ┌───────┐ ┌───────┐
         │Gateway │   │LiteLLM │ │MLflow│ │Kafka  │ │ArgoCD │
         │  UI    │   │Postgres│ │Redis │ │MinIO  │ │Prome. │
         └────────┘   │pgvector│ │Post. │ │Click. │ │Grafana│
                      └────────┘ └──────┘ │ArgoWF │ │Loki   │
                                          └───────┘ └───────┘
```

Toda a stack roda em Kubernetes (k3s via k3d), gerenciada via Helm charts por namespace. NetworkPolicy isola os namespaces: `ns:ui` não acessa `ns:data` diretamente.

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
    data/                   # Kafka, MinIO, ClickHouse, Argo Workflows
    ml/                     # MLflow + Postgres, Redis
    agent/                  # Postgres + pgvector, LiteLLM
    ui/                     # gateway e ui (stubs nginx)
    infra/                  # ArgoCD, Prometheus, Grafana
  overlays/
    dev/                    # ingresses.yaml (subdomínios *.ops-ahead.localtest.me)
    prod/                   # overlay de produção
infra/
  scripts/
    dev-setup.sh            # prepara a máquina (rodar uma vez)
    dev-up.sh               # sobe o ambiente
    dev-down.sh             # derruba o ambiente
scripts/
  prepare_dataset.py        # pipeline Excel → CSV
Makefile                    # atalhos: make setup / up / down
```

---

## Infraestrutura local (K8s)

**Único pré-requisito:** Docker instalado e rodando.

### Primeira vez na máquina

```bash
make setup
```

Instala kubectl, Helm e k3d em `~/.local/bin` e adiciona os repositórios Helm. Não toca em nenhuma configuração do sistema.

### Subir o ambiente

```bash
make up
```

Cria o cluster k3d (se não existir), baixa as dependências dos charts e instala todos os namespaces em ordem. Equivalente ao `docker compose up`.

### Derrubar o ambiente

```bash
make down
```

### Serviços disponíveis

Após `make up`, todos os serviços ficam acessíveis via porta 80. Os subdomínios usam `*.localtest.me`, um wildcard DNS público que resolve para `127.0.0.1` — não é preciso instalar nada nem abrir nenhum arquivo do sistema:

| Serviço | URL | Credenciais |
|---------|-----|-------------|
| Vault | http://vault.ops-ahead.localtest.me | token: `VAULT_TOKEN` do .env |
| ArgoCD | http://argocd.ops-ahead.localtest.me | `DEV_USER` / `DEV_PASSWORD` |
| Grafana | http://grafana.ops-ahead.localtest.me | `DEV_USER` / `DEV_PASSWORD` |
| MinIO | http://minio.ops-ahead.localtest.me | `DEV_USER` / `DEV_PASSWORD` |
| Prometheus | http://prometheus.ops-ahead.localtest.me | — |
| MLflow | http://mlflow.ops-ahead.localtest.me | — |
| Argo Workflows | http://argo-workflows.ops-ahead.localtest.me | — |
| LiteLLM | http://litellm.ops-ahead.localtest.me | — |
| Gateway | http://gateway.ops-ahead.localtest.me | — |
| UI | http://ui.ops-ahead.localtest.me | — |

> Para expor externamente durante testes: `ngrok http 80`

### Configurar API keys (LiteLLM)

O LiteLLM sobe com chaves placeholder. Para usar modelos reais:

```bash
kubectl edit secret litellm-api-keys -n agent
# substituir os valores base64 de ANTHROPIC_API_KEY e OPENAI_API_KEY
kubectl rollout restart deployment/litellm -n agent
```

---

## Análise de dados (Python)

**Pré-requisito:** Python 3.12+, gerenciado com `uv`

```bash
uv sync
```

O dataset já está processado em `assets/incidents.csv`. Para reprocessar a partir do Excel original:

```bash
python scripts/prepare_dataset.py
```

**Campos principais:**

| Campo | Descrição |
|-------|-----------|
| `prioridade_codigo` | 1=Crítico, 2=Alto, 3=Médio, 4=Baixo, 5=Muito Baixo |
| `aberto_em` | Datetime de abertura do incidente |
| `duracao_segundos` | Tempo de resolução em segundos |
| `entrou_kpi` | 1 se contado no KPI |
| `kpi_violado` | 1 se OLA foi violado |

**Regras de OLA:** somente P1–P3 são medidos · P1/P2 ≤ 4h · P3 ≤ 12h · P4 ≤ 24h · P5 ≤ 96h

---

## Sprints

| Sprint | Entrega | Status |
|--------|---------|--------|
| Sprint 1 — Ideação | 2026-04-27 | Concluída |
| Sprint 2 — Arquitetura + EDA | 2026-05-24 | Em andamento |
| Sprint 3 — MVP | 2026-08-23 | Planejada |
| Sprint 4 — Final | 2026-09-08 | Planejada |
