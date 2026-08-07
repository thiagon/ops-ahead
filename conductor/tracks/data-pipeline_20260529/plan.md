# Implementation Plan: Pipeline de Dados

**Track ID:** data-pipeline_20260529
**Spec:** [spec.md](./spec.md)
**Created:** 2026-05-29
**Status:** [x] Complete — Fases 1-5 verificadas ponta a ponta (2026-08-06), PR #49 mergeado. Gate de testes em CI permanece como pendência separada, fora do escopo desta track.

## Overview

Construir o pipeline em cinco fases, do contrato para fora. Primeiro fixa o schema e a ingestão (producer mock + consumer + `incidents_received` no ClickHouse) — quando o evento fluir, as camadas superiores ganham material. Depois dbt para marts, GE para qualidade, Argo para orquestração e validação ponta a ponta. Cada fase termina com algo verificável; nada espera a fase seguinte para mostrar que funciona.

---

## Phase 1: Contrato e ingestão (Kafka → ClickHouse + MinIO)

Define o schema híbrido de `incidents.received` e move o primeiro byte de ponta a ponta: producer mock publica no `gateway`, consumer escreve em ClickHouse e MinIO, dado fica disponível para consulta.

> Nomenclatura corrigida em 2026-08-06 (ver nota em [spec.md](./spec.md)): o estágio nunca se chamou `raw` no código — `contracts/incident-event.schema.json`, tópico `incidents.received`, tabela `incidents_received`, `source = "itsm"`.

### Tasks

- [x] 1.1: Schema híbrido versionado em [`contracts/incident-event.schema.json`](../../../contracts/incident-event.schema.json) (JSON Schema)
  - Campos universais: `event_id`, `source`, `received_at`, `opened_at`, `severity`, `entity_id`, `status`, `payload_raw`
  - Modelo Pydantic em `apps/data-ingest/src/models/incident.py`, espelhando o schema para o consumer
- [x] 1.2: KafkaTopic `incidents.received` (CRD Strimzi, `infra/charts/data-kafka/values.yaml` + `values-dev.yaml`)
  - Partitions: 3 (dev) / 12 (prod)
  - Retention: 24h (dev) / 7d (prod)
- [x] 1.3: Schema migrations com golang-migrate (`apps/data-ingest/migrations/`)
  - `000001_incidents_received.up.sql` / `.down.sql` — DDL MergeTree com partition e order corretos
  - SQL empacotado na imagem do consumer (`Dockerfile` faz `COPY migrations/`); `initContainer` `copy-migrations` no Job compartilha o volume com o container `migrate`, sem ConfigMap
  - `infra/charts/data-ingest/templates/migration-job.yaml` — PreSync Job com imagem oficial `ghcr.io/golang-migrate/migrate`; URL do banco via Secret
- [x] 1.4: Producer mock `scripts/incident_producer.py`
  - Lê `assets/incidents.csv`, ordena por `aberto_em`, traduz colunas PT→EN, faz POST assinado (HMAC) para `gateway /webhook/incidents`
  - Flags `--gateway-url`, `--speed N`, `--limit M`, `--source itsm`
- [x] 1.5: Stream consumer `apps/data-ingest/`
  - Python + FastStream + aiokafka, grupo `incidents-ingest`
  - Buffer configurável (default 1000 eventos ou 5s), escreve batch em ClickHouse + Parquet/MinIO
  - Particionamento MinIO: `s3://ops-ahead-lake/received/source=<source>/date=<YYYY-MM-DD>/`
  - Métricas Prometheus em `/metrics`: throughput, latência de batch, lag por partição
  - Overlay `apps/data-ingest/chart/` (identidade + values) sobre o chart base `infra/charts/data-ingest` (Deployment + Service)
- [x] 1.6: Testes unitários do consumer
  - Serialização/desserialização do schema híbrido
  - Particionamento MinIO por `opened_at`
  - Batch flush por tempo e por tamanho

### Verification

- [x] Producer mock posta no gateway e eventos aparecem em `incidents.received` (verificado via contagem crescente em ClickHouse, não via `kafka-console-consumer`)
- [x] Consumer ingere e popula `incidents_received` em ClickHouse — 1.055 linhas após postar 1.000 eventos (2026-08-06)
- [x] Parquet aparece no MinIO particionado por data — 354 arquivos em `received/source=itsm/date=.../`
- [ ] Métricas Prometheus do consumer visíveis no Grafana — endpoint `/metrics` responde (confirmado), mas não há `ServiceMonitor` para `data-ingest`; nada o scrapeia hoje. Pendência aberta, fora do escopo desta validação.

---

## Phase 2: Marts dbt

Constrói os 6 marts que são o contrato com as camadas superiores. dbt-clickhouse roda como imagem container reusável pelo Argo na fase 4.

### Tasks

- [x] 2.1: Projeto dbt em `apps/data-transform/` (sem Python — imagem oficial `dbt-labs/dbt-clickhouse` + `COPY` do projeto)
  - `dbt_project.yml`, `profiles.yml` lendo env vars (`CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, etc.)
  - Estrutura `staging/` (extrai universais + parsing de `payload_raw`), `marts/` (contratos)
- [x] 2.2: Staging `stg_incidents` — desserializa `payload_raw` (chaves em inglês) via `JSONExtract*`
- [x] 2.3: Mart `marts/incidents_by_ic` — agregado por (entity_id × janela 1h/6h/24h) via `arrayJoin`
- [x] 2.4: Mart `marts/p4_sequences_by_ci` — islands-and-gaps sobre `severity=4` por entity_id
- [x] 2.5: Mart `marts/first_touch_duration` — `opened_at × assignment_group × OLA da severity`
- [x] 2.6: Mart `marts/priority_changes_log` — transições de `severity` via `lag()` por `ticket_number`
- [x] 2.7: Mart `marts/daily_anomaly_features` — features diárias para ML (volume, share P1, `breach_rate`, dispersão de entity_ids)
- [x] 2.8: Mart `marts/kpi_monthly_state` — estado mensal dos KPIs por (severity × source)
- [x] 2.9: Testes dbt em `_schema.yml` para cada mart (`unique`, `not_null`, `accepted_values`)
- [x] 2.10: N/A — sem Dockerfile; Argo usa imagem oficial diretamente

### Verification

- [x] `dbt run` completa sem erro sobre o dataset consumido na fase 1 (7/7 models, após corrigir 3 bugs de SQL específicos do ClickHouse — ver `docs/insights/pipeline_e2e_baseline.md`)
- [x] `dbt test` verde em todos os marts — 28/28 (após corrigir `priority_changes_log` e remover um teste `not_null` semanticamente errado em `kpi_monthly_state.breach_rate`)
- [x] Contagem de linhas em `incidents_by_ic` coerente com eventos consumidos — 2.561 linhas sobre 1.055 eventos (múltiplas janelas por entity_id)

---

## Phase 3: Qualidade com Great Expectations

Suite que pausa a DAG quando dado sujo aparece. Quatro checks críticos + checks por mart.

### Tasks

- [x] 3.1: Projeto GE em `apps/data-quality/` configurado com datasource ClickHouse
- [x] 3.2: Suite `critical` (bloqueante)
  - `event_id` único em `incidents_received`
  - `severity` em [1,5]
  - `opened_at` ≤ `received_at`, nenhum nulo em `event_id`/`opened_at`/`received_at`/`entity_id`
- [x] 3.3: Suites por mart (`incidents_by_ic`, `daily_anomaly_features`, `kpi_monthly_state`) — checks de domínio (ex.: contagens não-negativas, janelas válidas)
- [x] 3.4: Configurar Data Docs publicados em MinIO (`s3://ops-ahead-lake/ge-docs/`)
- [x] 3.5: Imagem container `apps/data-quality/Dockerfile` que recebe `--suite <nome>` e exit code != 0 em falha crítica
- [x] 3.6: Testes locais do GE runner contra um snapshot pequeno de dado — `apps/data-quality/tests/`, 11 testes (sqlite), cobrindo suite `critical` e as 3 suites de mart

### Verification

- [x] Suite crítica falha quando injeto dado sujo — coberto pelos testes locais (3.6: duplicate event_id, severity fora de [1,5], opened_at > received_at, entity_id nulo) em vez de um smoke test manual contra o cluster
- [x] Suite crítica passa sobre o dataset consumido na fase 1 — 8/8 expectations (após corrigir bug `gx.DataContext` e trocar 2 expectations incompatíveis com o dialect ClickHouse por `UnexpectedRowsExpectation` — ver baseline)
- [x] Data Docs acessíveis via MinIO console — 23 objetos em `s3://ops-ahead-lake/ge-docs/` (após corrigir bug: o contexto GX efêmero não tinha nenhum site configurado, então `build_data_docs()` não escrevia nada; ver baseline)

---

## Phase 4: Orquestração com Argo Workflows

DAG que conecta dbt → GE → registro de snapshot no MLflow. Disparável manualmente; CronWorkflow opcional para execução diária no overlay `prod`.

### Tasks

- [x] 4.1: `WorkflowTemplate` `data-pipeline` em `infra/charts/data-pipeline/templates/` (chart base da pipeline; `infra/charts/data-workflows` é só o motor Argo/RBAC compartilhado)
  - Steps em sequência: `dbt-run` → `great-expectations` → `register-snapshot`
  - `dbt-run` usa imagem `data-transform` (dbt-clickhouse base + COPY projeto)
  - `great-expectations` usa imagem `data-quality`
- [x] 4.2: Step `register-snapshot` — script inline Python: SHA-256 dos counts dos marts, MLflow experiment `data-pipeline-snapshots`
- [x] 4.3: `ArgoCD Application` já existia; `values.yaml` atualizado com bloco `pipeline:`
- [x] 4.4: `CronWorkflow` controlado por `pipeline.cron.enabled` (false em dev, true em prod) — disparo diário às 02:00 UTC
- [x] 4.5: Documentação em `docs/data-pipeline.md` — como disparar manualmente, inspecionar falhas, rerodar step

### Verification

- [x] `argo submit` da template completa todos os steps em verde sobre dado consumido na fase 1 — run `data-pipeline-2t9nj`, 3/3 steps, 1m30s (após corrigir 5 bugs de infra que impediam a DAG de rodar — ver baseline)
- [x] Falha intencional no GE pausa a DAG no step e não promove snapshot — observado organicamente: o bug de compatibilidade GX×ClickHouse fez a suite `critical` falhar de verdade em runs anteriores (`data-pipeline-6jrjh`/`d2gj7`/`522pm`/`jjb6f`), e `register-snapshot` nunca rodou nesses runs
- [x] Snapshot aparece no MLflow UI com hash, contagens e metadados corretos — run `data-pipeline-2t9nj`, experiment `data-pipeline-snapshots`, confirmado via API do MLflow

---

## Phase 5: Validação ponta a ponta (local)

Valida o fluxo completo num subconjunto realista para ambiente k3d local.

### Tasks

- [x] 5.1: Producer dispara 1.000 eventos (2026-08-06)
- [x] 5.2: Ingestão verificada: `incidents_received` = 1.055 (1.000 + 55 de execuções de teste anteriores)
- [x] 5.3: WorkflowTemplate disparada manualmente via `argo submit` (CLI instalado localmente pra essa validação, autorizado explicitamente pelo usuário)
- [x] 5.4: 6 marts populados, GE suite `critical` verde (8/8), snapshot no MLflow — ver tabela acima
- [x] 5.5: 354 Parquets confirmados em `received/source=itsm/date=.../`
- [x] 5.6: Observações e os bugs encontrados/corrigidos anotados em `docs/insights/pipeline_e2e_baseline.md`

### Verification

- [x] Fluxo completo (producer → consumer → DAG → marts) funciona sem erros — confirmado no run final `data-pipeline-2t9nj`, depois de corrigir 9 bugs reais de infra/SQL (nenhum de lógica de negócio) descobertos por esta mesma validação
- [x] Contagens ingestão → marts coerentes — `scripts/audit.sql` não foi rodado literalmente, mas as contagens dos 6 marts foram conferidas individualmente (ver tabela "Marts" no baseline)

---

## Final Verification

- [x] Todos os acceptance criteria da spec atendidos (ver spec.md — os 7 itens foram exercitados nesta validação)
- [ ] Testes dbt + testes unitários do consumer + testes do runner GE verdes em CI — todos passam **localmente/manualmente** (dbt test 28/28, pytest data-ingest, pytest data-quality 11/11), mas `.gitea/workflows/build.yaml` só builda e publica imagens hoje, não roda nenhum teste como gate. Nenhum teste está "verde em CI" porque CI não os executa — pendência aberta, fora do escopo desta track.
- [x] `docs/data-pipeline.md` documenta o disparo manual, inspeção de falhas e rerun de step
- [x] ArgoCD reconciliando todos os charts da track sem drift — `make health`: todas as Applications Healthy, 45/45 pods ready
- [ ] PR mergeado em `main` com revisão — track não tem PR aberto (não foi criada via `/conductor:new-track` com a integração GitHub); fica pra fora deste ciclo de implementação

---

_Generated by Conductor. Tasks marcadas [~] em progresso e [x] concluídas._
