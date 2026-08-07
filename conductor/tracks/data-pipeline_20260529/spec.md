# Specification: Pipeline de Dados

**Track ID:** data-pipeline_20260529
**Type:** Feature
**Created:** 2026-05-29
**Status:** Draft

## Summary

Construir a Camada 1 da arquitetura ponta a ponta: stream consumer Kafka → ClickHouse, 6 marts dbt, validações Great Expectations e DAG Argo orquestrando transformação e qualidade. O CSV histórico entra como **origem mock temporária** através de um producer simples que fala com o `gateway` real (`apps/ui-gateway`, entregue pela track `gateway-ingest_20260802`) — o mock é a única peça acoplada ao CSV; tudo a partir do tópico Kafka é código de produção.

## Context

A infra base está deployada. Kafka, MinIO, ClickHouse, Argo Workflows e MLflow estão em pé. O `gateway` (`gateway-ingest_20260802`) também já está em pé e expõe `/webhook/incidents`. Esta track conecta os componentes em um pipeline cuja interface de entrada é o tópico `incidents.received` — não o arquivo CSV.

> **Nota (2026-08-06):** a camada de domínio (`domain-spec_20260803`) formalizou depois desta spec ter sido escrita a Ubiquitous Language e a ACL do ITSM. `raw` foi descartado como nome de estágio — ver [`domain/ubiquitous-language.md`](../../../domain/ubiquitous-language.md) ("Como nomear um estágio") — e o schema publicado é [`contracts/incident-event.schema.json`](../../../contracts/incident-event.schema.json), não um arquivo `incidents-raw`. Esta spec foi atualizada para usar os nomes atuais; os detalhes de campo vivem nesses documentos, não aqui.

O sistema vai consumir alertas de origens externas (AlertManager, Datadog, ITSM Locaweb, e outras no futuro). Cada origem tem seu próprio contrato — não controlamos o payload. O `gateway` recebe webhook, extrai os campos universais que sabemos mapear e preserva o resto verbatim. O tópico `incidents.received` usa schema **híbrido** para acomodar essa realidade: campos first-class para o que é comum + bloco `payload_raw` para o que é específico da origem — ver [`domain/acl/itsm.md`](../../../domain/acl/itsm.md) para a tradução ITSM → domínio.

O `incidents.csv` (122.543 linhas) entra como uma das origens — `scripts/incident_producer.py` lê o CSV, traduz os nomes de coluna para inglês (o dicionário original em português vive só no mock, nunca cruza a fronteira) e faz POST para o `gateway` (`/webhook/incidents`) com `source=itsm`, exatamente como o ITSM real faria. O `gateway` normaliza e publica em `incidents.received`. Quando o webhook real do ITSM estiver em produção, o script é desligado e nada mais muda a partir do tópico Kafka.

Os marts produzidos aqui são contratos de dados consumidos pelos modelos (Track 2), `burst-detector` (Track 3) e `agent` (Track 4).

## User Story

As a engenheiro de ML, I want to consumir marts validados com features de domínio prontas so that posso treinar modelos sem reimplementar agregações em cada experimento.

As a engenheiro do copiloto, I want to consultar contexto histórico de um IC em uma única query SQL so that as ferramentas do `agent` respondem em menos de 50ms sem cálculo em tempo de inferência.

As a operador do pipeline, I want to trocar a origem do CSV para o webhook real sem alterar o pipeline so that a transição para produção é apenas desligar o producer mock.

## Acceptance Criteria

- [ ] Stream consumer roda como Deployment no `ns: data`, consome `incidents.received` e popula `incidents_received` em ClickHouse + Parquet no MinIO
- [ ] Producer mock (`scripts/incident_producer.py`) posta eventos do CSV no `gateway` (`/webhook/incidents`), que os normaliza e publica em `incidents.received`
- [ ] DAG Argo `data-pipeline` executa `dbt-run → great-expectations → register-snapshot` sem intervenção manual
- [ ] Todos os 6 marts populados em ClickHouse com contagem coerente com os eventos consumidos
- [ ] Suite Great Expectations aprovada; falha crítica pausa a DAG antes de promover dados
- [ ] Hash do snapshot + timestamp + ID da DAG registrados no MLflow para auditoria
- [ ] Fluxo completo (producer → consumer → DAG → marts) executa em menos de 15 minutos no dataset histórico

## Dependencies

- **Infra base** (`k8s-infra_20260514`, completa) — Kafka, MinIO, ClickHouse, Argo Workflows, MLflow + Postgres provisionados
- **Gateway de ingestão** (`gateway-ingest_20260802`, completa) — `apps/ui-gateway` expõe `/webhook/incidents`, valida assinatura HMAC e publica em `incidents.received`; o producer mock desta track depende dele para funcionar ponta a ponta
- **Camada de domínio** (`domain-spec_20260803`, completa) — `domain/ubiquitous-language.md` e `domain/acl/itsm.md` são a fonte da nomenclatura usada aqui; `contracts/incident-event.schema.json` é o schema of record
- **Dataset processado** — `assets/incidents.csv` já versionado

## Out of Scope

- Treino de modelos consumindo os marts — Track 2
- `burst-detector` consumindo `incidents.received` em paralelo — Track 3
- Airbyte para fontes externas (status page, Prometheus) — refinamento final
- Iceberg metadata sobre Parquets do MinIO — refinamento final
- Trino para queries federadas — refinamento final

## Technical Notes

- **Fronteira clara:** o `gateway` (`apps/ui-gateway`) é a única peça que normaliza o payload e publica em `incidents.received`. O producer mock é a única peça acoplada ao CSV. Tudo a partir de `incidents.received` é código de produção.
- **Schema híbrido em `incidents.received`:** definido em [`contracts/incident-event.schema.json`](../../../contracts/incident-event.schema.json) — campos first-class universais (`event_id`, `source`, `received_at`, `opened_at`, `severity`, `entity_id`, `status`) + `payload_raw` com o evento original verbatim, já com chaves em inglês (a tradução PT→EN acontece no producer mock, nunca na fronteira — ver [`domain/acl/itsm.md`](../../../domain/acl/itsm.md)).
- **Mapeamento ITSM → universais** (responsabilidade do gateway, `apps/ui-gateway/src/modules/incidents/service.ts`): `event_id` gerado pelo gateway; `source` = `"itsm"`; `opened_at` normalizado para UTC; `severity` = `priority_code`; `entity_id` = `configuration_item`; `status` = `status`; `payload_raw` = JSON dos campos traduzidos pelo mock.
- **Stream consumer:** Python + FastStream, grupo `incidents-ingest`. Faz buffer e escreve em batch no ClickHouse + Parquet/MinIO particionado por `toDate(opened_at)`. Mantém os universais em colunas dedicadas e `payload_raw` como `String` (JSON) no ClickHouse.
- **Tabelas ClickHouse:** engine `MergeTree`, `PARTITION BY toYYYYMM(opened_at)`, `ORDER BY (entity_id, opened_at)` nos marts time-series. Marts específicos do ITSM (ex.: `p4_sequences_by_ci`) leem `payload_raw` via funções JSON do ClickHouse e filtram por `source = 'itsm'`.
- **Modelagem dbt:** camadas `staging → marts` em `apps/data-transform/`. Marts são o único contrato exposto às camadas superiores.
- **GE bloqueante:** suite `critical` — `event_id` único, `severity` em [1,5], nenhum nulo em `event_id`/`opened_at`/`received_at`/`entity_id`, `opened_at ≤ received_at`.
- **Snapshot MLflow:** experimento `data-pipeline-snapshots` registra hash dos marts + timestamp + ID da DAG para reproduzir o estado de dados visto por uma inferência.
- **Producer mock:** `scripts/incident_producer.py --gateway-url <url> --speed N --limit M --source itsm`. Script local — não vai para o K8s. Lê CSV, ordena por `aberto_em`, traduz nomes de coluna PT→EN e faz POST para `gateway /webhook/incidents` assinado (HMAC). O gateway normaliza e publica em `incidents.received`. Substituível pelo webhook real do ITSM sem alterar nada no consumer.

---

_Generated by Conductor. Review and edit as needed._
