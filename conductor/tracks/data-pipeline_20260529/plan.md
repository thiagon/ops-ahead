# Implementation Plan: Pipeline de Dados

**Track ID:** data-pipeline_20260529
**Spec:** [spec.md](./spec.md)
**Created:** 2026-05-29
**Status:** [ ] Not Started

## Overview

Construir o pipeline em cinco fases, do contrato para fora. Primeiro fixa o schema e a ingestão (producer mock + consumer + ClickHouse raw) — quando dado bruto fluir, as camadas superiores ganham material. Depois dbt para marts, GE para qualidade, Argo para orquestração e validação ponta a ponta. Cada fase termina com algo verificável; nada espera a fase seguinte para mostrar que funciona.

---

## Phase 1: Contrato e ingestão (Kafka → ClickHouse + MinIO)

Define o schema híbrido de `incidents.raw` e move o primeiro byte de ponta a ponta: producer mock publica, consumer escreve em ClickHouse e MinIO, dado bruto fica disponível para consulta.

### Tasks

- [x] 1.1: Schema híbrido versionado em `contracts/incidents-raw.schema.json` (JSON Schema)
  - Campos universais: `event_id`, `source`, `received_at`, `opened_at`, `severity`, `entity_id`, `status`, `payload_raw`
  - Geração de modelo Pydantic via `datamodel-code-generator` para o consumer
- [x] 1.2: KafkaTopic `incidents.raw` (CRD Strimzi em `infra/charts/data-kafka`)
  - Partitions: 3 (dev) / 12 (prod)
  - Retention: 24h (dev) / 7d (prod)
- [x] 1.3: Schema migrations com golang-migrate (`infra/charts/data-ingest/migrations/`)
  - `000001_incidents_raw.up.sql` / `.down.sql` — DDL MergeTree com partition e order corretos
  - ConfigMap Helm gerado dos arquivos SQL; montado no Job
  - `infra/charts/data-ingest/templates/migration-job.yaml` — PreSync Job com imagem oficial `ghcr.io/golang-migrate/migrate`; URL do banco via Secret
- [x] 1.4: Producer mock `scripts/incident_producer.py`
  - Lê `assets/incidents.csv`, ordena por `aberto_em`, faz POST para `gateway /webhook/incidents` com payload bruto do ITSM
  - Flags `--gateway-url`, `--speed Nx`, `--limit M`, `--source itsm-locaweb`
- [x] 1.5: Stream consumer `apps/data-ingest/`
  - Python + FastStream + aiokafka, grupo `raw-ingest`
  - Buffer configurável (default 1000 eventos ou 5s), escreve batch em ClickHouse + Parquet/MinIO
  - Particionamento MinIO: `s3://ops-ahead-lake/raw/source=<source>/date=<YYYY-MM-DD>/`
  - Métricas Prometheus em `/metrics`: throughput, latência de batch, lag por partição
  - Chart `infra/charts/data-ingest` (Deployment + Service)
- [x] 1.6: Testes unitários do consumer
  - Serialização/desserialização do schema híbrido
  - Particionamento MinIO por `opened_at`
  - Batch flush por tempo e por tamanho

### Verification

- [ ] Producer mock posta no gateway e eventos aparecem em `incidents.raw` (`kafka-console-consumer` mostra mensagens)
- [ ] Consumer ingere e popula a tabela raw em ClickHouse (`SELECT count() FROM incidents_raw` cresce)
- [ ] Parquet aparece no MinIO particionado por data
- [ ] Métricas Prometheus do consumer visíveis no Grafana

---

## Phase 2: Marts dbt

Constrói os 6 marts que são o contrato com as camadas superiores. dbt-clickhouse roda como imagem container reusável pelo Argo na fase 4.

### Tasks

- [ ] 2.1: Projeto dbt em `apps/data-transform/` com `dbt-clickhouse`
  - `dbt_project.yml`, `profiles.yml` (perfil `clickhouse-dev` apontando para o `ns: data`)
  - Estrutura `staging/` (extrai universais + parsing de `payload_raw`), `intermediate/` (joins e features), `marts/` (contratos)
- [ ] 2.2: Staging `stg_incidents` — desserializa `payload_raw` para os 27 campos ITSM via `JSONExtract*`
- [ ] 2.3: Mart `marts/incidents_by_ic` — agregado por (entity_id × janela 1h/6h/24h)
- [ ] 2.4: Mart `marts/p4_sequences_by_ci` — window function sobre `severity=4` por entity_id (sequências crescentes)
- [ ] 2.5: Mart `marts/first_touch_duration` — `opened_at × grupo_designado_inicial × OLA da severity`
- [ ] 2.6: Mart `marts/priority_changes_log` — histórico de transições de `severity` extraído de eventos sequenciais por `event_id`
- [ ] 2.7: Mart `marts/daily_anomaly_features` — features diárias (volume, share P1, % abertura manual, dispersão de entity_ids)
- [ ] 2.8: Mart `marts/kpi_monthly_state` — estado mensal dos 4 KPIs PPR por (severity × dimensão)
- [ ] 2.9: Testes dbt em cada mart (`unique`, `not_null`, relações entre marts)
- [ ] 2.10: Imagem container `apps/data-transform/Dockerfile` versionada no Gitea registry

### Verification

- [ ] `dbt run --select marts.*` completa sem erro sobre o dataset bruto da fase 1
- [ ] `dbt test` verde em todos os marts
- [ ] Contagem de linhas em `incidents_by_ic` coerente com eventos consumidos

---

## Phase 3: Qualidade com Great Expectations

Suite que pausa a DAG quando dado sujo aparece. Quatro checks críticos + checks por mart.

### Tasks

- [ ] 3.1: Projeto GE em `apps/data-quality/` configurado com datasource ClickHouse
- [ ] 3.2: Suite `critical` (bloqueante)
  - `event_id` único na tabela raw
  - `severity` em [1,5]
  - `opened_at` ≤ `received_at` e nenhum nulo
  - Contagem por `source` coerente entre raw e marts (sem perda silenciosa)
- [ ] 3.3: Suites por mart (`incidents_by_ic`, `p4_sequences_by_ci`, ...) — checks de domínio (ex.: contagens não-negativas, janelas válidas)
- [ ] 3.4: Configurar Data Docs publicados em MinIO (`s3://ops-ahead-lake/ge-docs/`)
- [ ] 3.5: Imagem container `apps/data-quality/Dockerfile` que recebe `--suite <nome>` e exit code != 0 em falha crítica
- [ ] 3.6: Testes locais do GE runner contra um snapshot pequeno de dado

### Verification

- [ ] Suite crítica falha quando injeto evento com `severity=99` (smoke test manual)
- [ ] Suite crítica passa sobre o dataset bruto da fase 1
- [ ] Data Docs acessíveis via MinIO console

---

## Phase 4: Orquestração com Argo Workflows

DAG que conecta dbt → GE → registro de snapshot no MLflow. Disparável manualmente; CronWorkflow opcional para execução diária no overlay `prod`.

### Tasks

- [ ] 4.1: `WorkflowTemplate` `data-pipeline` em `infra/charts/data-workflows/templates/`
  - Steps em sequência: `dbt-run` → `great-expectations` → `register-snapshot`
  - `dbt-run` e `great-expectations` usam imagens das fases 2 e 3
- [ ] 4.2: Step `register-snapshot` — script Python que calcula hash SHA-256 dos marts, registra no experimento MLflow `data-pipeline-snapshots` (params: hash, dag_run_id; metrics: contagem por mart; tags: source, timestamp)
- [ ] 4.3: `ArgoCD Application` apontando o template para reconciliação no overlay `dev`
- [ ] 4.4: `CronWorkflow` opcional (comentado no overlay `dev`, ativado no `prod`) — disparo diário às 02:00
- [ ] 4.5: Documentação em `apps/argo/README.md` — como disparar manualmente, como inspecionar falhas, como rerodar a partir de um step

### Verification

- [ ] `argo submit` da template completa todos os steps em verde sobre dado consumido na fase 1
- [ ] Falha intencional no GE pausa a DAG no step e não promove snapshot
- [ ] Snapshot aparece no MLflow UI com hash, contagens e metadados corretos

---

## Phase 5: Validação ponta a ponta

Roda o pipeline completo contra o dataset histórico e mede o que importa.

### Tasks

- [ ] 5.1: Producer dispara o CSV completo (122.543 eventos) em modo `--speed 100x`
- [ ] 5.2: Aguardar consumer completar ingestão; verificar `count()` em `incidents_raw` coerente
- [ ] 5.3: Disparar `WorkflowTemplate data-pipeline`; medir tempo total da DAG
- [ ] 5.4: Verificar 6 marts populados, GE verde, snapshot MLflow registrado
- [ ] 5.5: Verificar Parquets no MinIO particionados por data
- [ ] 5.6: Registrar tempos em `docs/insights/pipeline_e2e_baseline.md` (mediana e p95 por step)

### Verification

- [ ] Fluxo completo (producer → consumer → DAG → marts) abaixo de 15 minutos no dataset histórico
- [ ] Contagens raw → marts coerentes (auditoria via SQL ad-hoc)

---

## Final Verification

- [ ] Todos os acceptance criteria da spec atendidos
- [ ] Testes dbt + testes unitários do consumer verdes em CI
- [ ] `apps/ingest`, `apps/dbt`, `apps/ge` documentados em READMEs próprios
- [ ] ArgoCD reconciliando todos os charts da track sem drift
- [ ] PR mergeado em `main` com revisão

---

_Generated by Conductor. Tasks marcadas [~] em progresso e [x] concluídas._
