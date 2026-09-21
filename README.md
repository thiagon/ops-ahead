# Ops Ahead — AIOps Locaweb

Sistema de AIOps para predição e explicação de padrões de incidentes de TI sobre o dataset ITSM da Locaweb. Antecipa volume de incidentes (D+1 e D+7), identifica risco de violação de OLA e apoia decisões operacionais.

**Projeto:** FIAP Enterprise Challenge 2026

---

## Índice

- [Visão geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Infraestrutura local (K8s)](#infraestrutura-local-k8s)
- [Desenvolvimento Python](#desenvolvimento-python)
- [Sprints](#sprints)

---

## Visão geral

O Ops Ahead é um sistema AIOps modular em quatro camadas:

```
Dados → Modelos → Copiloto IA → Interfaces
```

| Camada | Componentes |
|--------|-------------|
| **Dados** | Kafka (Strimzi), MinIO, ClickHouse (Altinity) |
| **Modelos** | MLflow tracking + AI Gateway, Postgres, Redis |
| **Copiloto IA** | Agent LangGraph, Postgres + pgvector |
| **Interfaces** | Gateway + UI Nuxt |
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
         │Gateway │   │ Agent  │ │MLflow│ │Kafka  │ │ArgoCD │
         │  UI    │   │Postgres│ │Redis │ │MinIO  │ │Prome. │
         └────────┘   │pgvector│ │Post. │ │Click. │ │Grafana│
                      └────────┘ └──────┘ │ArgoWF │ │Loki   │
                                          └───────┘ └───────┘
```

Toda a stack roda em Kubernetes (k3s via k3d), gerenciada via Helm charts por namespace. NetworkPolicy isola os namespaces: `ns:ui` não acessa `ns:data` diretamente.

---

## Estrutura do repositório

Monorepo com workspaces `uv` para Python. Cada app em `apps/` gera sua própria imagem Docker e vai para o K8s; o tipo de workload e namespace estão declarados em `[tool.ops-ahead]` no `pyproject.toml` de cada app.

```
apps/                              # serviços e jobs que vão para o K8s
  data-ingest/                     # Deployment — consumer Kafka → ClickHouse + MinIO, estágio de tradução
  data-runner/                     # Deployment (KEDA ScaledObject) — dbt-clickhouse (marts) + Great Expectations, consome trigger.data
  data-deadline-tracker/           # Deployment — acompanha incidents abertos elegíveis, emite deadlines.milestone
  ml-trainer/                      # Deployment (KEDA ScaledObject) — treino volume/breach/external-event, consome trigger.ml
  ml-burst-detector/                # Deployment — consome events.monitor, detecta rajada por entity, publica alerts.burst
  ml-model-serving/                 # Deployment — serving BentoML dos modelos volume/breach registrados no MLflow
  ui-gateway/                       # Deployment — fronteira HTTP: webhooks → events.raw.*; POST /analyses → trigger.ml/trigger.data

contracts/                         # JSON Schemas compartilhados entre apps
  event-envelope.schema.json       # envelope cru, agnóstico de natureza, antes da tradução
  incident-alert.schema.json       # entrada alert traduzida (ocorrência gerenciada)
  condition-monitor.schema.json    # entrada monitor traduzida (condição observada)
  deadline-milestone.schema.json   # marco de consumo do OLA (25/50/75/100%/abandono)
  translation-dictionary.schema.json  # dicionário de tradução por tenant e origem
  trigger-*.schema.json            # payloads de execução sob demanda (ui-gateway)

scripts/                           # utilitários locais (não vão para o K8s)
  prepare_dataset.py               # pipeline Excel → CSV
  incident_producer.py             # mock: publica assets/incidents.csv no Kafka

assets/
  incidents.csv                    # dataset processado (122.543 linhas, 27 colunas)

infra/
  charts/                          # Helm charts, um por app em apps/ (mesmo nome) + os compartilhados
    data-clickhouse/               # ClickHouse (Altinity operator)
    data-deadline-tracker/         # app — ver apps/ acima
    data-ingest/                   # app — ver apps/ acima
    data-kafka/                    # Kafka cluster + KafkaTopics (Strimzi)
    data-minio/                    # MinIO object storage
    data-runner/                   # app — ver apps/ acima
    data-strimzi/                  # Strimzi operator
    infra-argocd/                  # ArgoCD
    infra-eso/                     # External Secrets Operator
    infra-gitea/                   # Gitea (registry + git)
    infra-keda/                    # KEDA — escala a réplica dos consumers Kafka (ScaledObject) a partir do lag
    infra-prometheus/              # Prometheus + Grafana
    infra-secrets/                 # ClusterSecretStore
    infra-vault/                   # Vault
    ml-burst-detector/             # app — ver apps/ acima
    ml-mlflow/                     # MLflow tracking + AI Gateway
    ml-model-serving/              # app — ver apps/ acima
    ml-postgres/                   # Postgres (ns: ml)
    ml-redis/                      # Redis (ns: ml)
    ml-trainer/                    # app — ver apps/ acima
    ui-frontend/                   # UI Nuxt
    ui-gateway/                    # app — ver apps/ acima
  apps/                            # ArgoCD Application manifests
  bootstrap/                       # root-app (app-of-apps)
  scripts/
    dev-setup.sh                   # prepara a máquina (rodar uma vez)
    dev-up.sh                      # sobe o ambiente
    dev-down.sh                    # derruba o ambiente

docs/
  context/                         # dicionário de dados
  sprints/                         # requisitos por sprint
  insights/                        # análises e resultados

conductor/                         # track management (Conductor)
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

### Derrubar o ambiente

```bash
make down
```

### Adicionar um app novo

Cada app com `Dockerfile` builda via Gitea Actions (`.gitea/workflows/build.yaml`) — a lista de apps
buildados é uma matrix estática (`jobs.build.strategy.matrix.app`), não descoberta do filesystem.
Criar um app novo em `apps/` não o coloca lá sozinho: sem essa entrada a imagem nunca é publicada e
o pod fica em `ImagePullBackOff` indefinidamente.

Pra forçar o rebuild de todas as imagens sem esperar uma mudança de código sob `apps/` (por exemplo,
depois de um `make destroy`, quando o registry local fica vazio):

```bash
make up FORCE=1
make sync FORCE=1
```

### Serviços disponíveis

Após `make up`, todos os serviços ficam acessíveis via porta 80. Os subdomínios usam `*.localtest.me`, um wildcard DNS público que resolve para `127.0.0.1`.

| Serviço | URL | Credenciais |
|---------|-----|-------------|
| Vault | http://vault.ops-ahead.localtest.me | token: `VAULT_TOKEN` |
| ArgoCD | http://argocd.ops-ahead.localtest.me | `admin` / `ARGOCD_ADMIN_PASSWORD` |
| Grafana | http://grafana.ops-ahead.localtest.me | `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` |
| MinIO | http://minio.ops-ahead.localtest.me | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| MLflow | http://mlflow.ops-ahead.localtest.me | `MLFLOW_ADMIN_USERNAME` / `MLFLOW_ADMIN_PASSWORD` |
| Gitea | http://gitea.ops-ahead.localtest.me | `GITEA_ADMIN_USERNAME` / `GITEA_ADMIN_PASSWORD` |
| Prometheus | http://prometheus.ops-ahead.localtest.me | — |
| Gateway | http://gateway.ops-ahead.localtest.me | — |
| UI | http://ui.ops-ahead.localtest.me | — |

---

## Desenvolvimento Python

Monorepo gerenciado com `uv`. Um único `uv.lock` na raiz cobre todos os workspaces.

```bash
uv sync          # instala dependências de todos os workspaces
```

Para trabalhar em um app específico:

```bash
uv run --package ops-ahead-data-ingest pytest
```

O dataset já está processado em `assets/incidents.csv`. Para reprocessar a partir do Excel original:

```bash
uv run --package ops-ahead-scripts python scripts/prepare_dataset.py
```

**Campos principais do dataset:**

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
| Sprint 2 — Arquitetura + EDA | 2026-05-24 | Concluída |
| Sprint 3 — MVP | 2026-08-23 | Concluída |
| Sprint 4 — Final | 2026-09-21 | Em andamento |
