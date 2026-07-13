# Specification: Pipeline de Dados

**Track ID:** data-pipeline_20260529
**Type:** Feature
**Created:** 2026-05-29
**Status:** Draft

## Summary

Construir a Camada 1 da arquitetura ponta a ponta: stream consumer Kafka → ClickHouse, 6 marts dbt, validações Great Expectations e DAG Argo orquestrando transformação e qualidade. O CSV histórico entra como **origem mock temporária** através de um producer simples — substituível pelo `gateway` real (Track 5) sem alterar nada a partir do tópico Kafka.

## Context

A infra base está deployada. Kafka, MinIO, ClickHouse, Argo Workflows e MLflow estão em pé, mas sem dado fluindo. Esta track conecta os componentes em um pipeline cuja interface de entrada é o tópico `incidents.raw` — não o arquivo CSV.

O sistema vai consumir alertas de origens externas (AlertManager, Datadog, ITSM Locaweb, e outras no futuro). Cada origem tem seu próprio contrato — não controlamos o payload. O `gateway` (Track 5) recebe webhook, extrai os campos universais que sabemos mapear e preserva o resto verbatim. Esta track desenha `incidents.raw` com schema **híbrido** para acomodar essa realidade: campos first-class para o que é comum + bloco `payload_raw` para o que é específico da origem.

O `incidents.csv` (122.543 linhas) entra como uma das origens — um script local lê o CSV e faz POST para o `gateway` (`/webhook/incidents`) com o payload bruto do ITSM, exatamente como o sistema real faria. O `gateway` é responsável por normalizar o schema e publicar em `incidents.raw`. Quando o `gateway` real estiver em produção, o script é desligado e o webhook do ITSM assume — nada muda a partir do tópico Kafka.

Os marts produzidos aqui são contratos de dados consumidos pelos modelos (Track 2), `burst-detector` (Track 3) e `agent` (Track 4).

## User Story

As a engenheiro de ML, I want to consumir marts validados com features de domínio prontas so that posso treinar modelos sem reimplementar agregações em cada experimento.

As a engenheiro do copiloto, I want to consultar contexto histórico de um IC em uma única query SQL so that as ferramentas do `agent` respondem em menos de 50ms sem cálculo em tempo de inferência.

As a operador do pipeline, I want to trocar a origem do CSV para o webhook real sem alterar o pipeline so that a transição para produção é apenas desligar o producer mock.

## Acceptance Criteria

- [ ] Stream consumer roda como Deployment no `ns: data`, consome `incidents.raw` e popula tabela raw em ClickHouse + Parquet no MinIO
- [ ] Producer mock (`scripts/incident_producer.py`) posta eventos do CSV no `gateway` (`/webhook/incidents`), que os normaliza e publica em `incidents.raw`
- [ ] DAG Argo `data-pipeline` executa `dbt-run → great-expectations → register-snapshot` sem intervenção manual
- [ ] Todos os 6 marts populados em ClickHouse com contagem coerente com os eventos consumidos
- [ ] Suite Great Expectations aprovada; falha crítica pausa a DAG antes de promover dados
- [ ] Hash do snapshot + timestamp + ID da DAG registrados no MLflow para auditoria
- [ ] Fluxo completo (producer → consumer → DAG → marts) executa em menos de 15 minutos no dataset histórico

## Dependencies

- **Infra base** (`k8s-infra_20260514`, completa) — Kafka, MinIO, ClickHouse, Argo Workflows, MLflow + Postgres provisionados
- **Dataset processado** — `assets/incidents.csv` já versionado

## Out of Scope

- Substituição do producer mock pelo `gateway` real — Track 5
- Treino de modelos consumindo os marts — Track 2
- `burst-detector` consumindo `incidents.raw` em paralelo — Track 3
- Airbyte para fontes externas (status page, Prometheus) — refinamento final
- Iceberg metadata sobre Parquets do MinIO — refinamento final
- Trino para queries federadas — refinamento final

## Technical Notes

- **Fronteira clara:** o `gateway` é a única peça que normaliza o payload e publica em `incidents.raw`. O producer mock é a única peça acoplada ao CSV. Tudo a partir de `incidents.raw` é código de produção.
- **Schema híbrido em `incidents.raw`:** campos first-class universais + `payload_raw` com o evento original verbatim. Campos universais mínimos: `event_id` (UUID), `source` (`itsm-locaweb` / `alertmanager` / `datadog` / ...), `received_at` (timestamp do consumer), `opened_at`, `severity` (1–5 normalizado), `entity_id` (IC/host/service), `status`, `payload_raw` (JSON). O `gateway` é responsável por preencher os universais a partir do contrato de cada origem.
- **Mapeamento ITSM Locaweb → universais (responsabilidade do gateway):** `event_id` = `incidente_id`; `source` = `"itsm-locaweb"`; `opened_at` = `aberto_em`; `severity` = `prioridade_codigo`; `entity_id` = `item_configuracao`; `status` = `status`; `payload_raw` = JSON dos 27 campos.
- **Stream consumer:** Python + FastStream, grupo `raw-ingest`. Faz buffer e escreve em batch no ClickHouse + Parquet/MinIO particionado por `toDate(opened_at)`. Mantém os universais em colunas dedicadas e `payload_raw` como `String` (JSON) no ClickHouse.
- **Tabelas ClickHouse:** engine `MergeTree`, `PARTITION BY toYYYYMM(opened_at)`, `ORDER BY (entity_id, opened_at)` nos marts time-series. Marts específicos do ITSM Locaweb (ex.: `p4_sequences_by_ci`) leem `payload_raw` via funções JSON do ClickHouse e filtram por `source = 'itsm-locaweb'`.
- **Modelagem dbt:** camadas `staging → intermediate → marts`. Marts são o único contrato exposto às camadas superiores.
- **GE bloqueante:** quatro checks críticos — `event_id` único, `severity` em [1,5], `opened_at` válido e coerente com `received_at`, contagem por `source` coerente com origem.
- **Snapshot MLflow:** experimento `data-pipeline-snapshots` registra hash dos marts + timestamp + ID da DAG para reproduzir o estado de dados visto por uma inferência.
- **Producer mock:** `scripts/incident_producer.py --gateway-url <url> --speed Nx --limit M`. Script local — não vai para o K8s. Lê CSV, ordena por `aberto_em`, faz POST para `gateway /webhook/incidents` com o payload bruto do ITSM. O gateway normaliza e publica em `incidents.raw`. Substituível pelo webhook real do ITSM sem alterar nada no consumer.

---

_Generated by Conductor. Review and edit as needed._
