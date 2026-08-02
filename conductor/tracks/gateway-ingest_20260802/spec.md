# Specification: Gateway de Ingestão (Motor de Integração)

**Track ID:** gateway-ingest_20260802
**Type:** Feature
**Created:** 2026-08-02
**Status:** Draft

## Summary

Construir a entrada do **Motor de Integração** (`gateway`, `ns: ui`): um serviço TypeScript + Fastify que expõe `POST /webhook/incidents`, valida assinatura HMAC, normaliza o payload do ITSM para o schema universal `incidents.raw` e publica no Kafka. Substitui o stub nginx atual e fecha o loop de ingestão `producer → gateway → incidents.raw → consumer` (consumer já entregue no #45).

## Context

A arquitetura da Sprint 2 (`docs/sprints/sprint-2-architecture.md` §3.4) define o `gateway` como a **fronteira HTTP externa** da solução, em TypeScript + Fastify no `ns: ui`. O fluxo end-to-end (§4) começa em `T+0s` com o ITSM emitindo `POST /webhook/incidents` — o gateway valida HMAC, normaliza e publica em `incidents.raw`.

Hoje esse endpoint não tem servidor: o `scripts/incident_producer.py` (mock) já faz `POST /webhook/incidents`, e o consumer (`apps/data-ingest`, #45) já drena `incidents.raw` para ClickHouse + MinIO. O meio está vazio. O `incidents.raw` tem contrato **híbrido** versionado em `contracts/incidents-raw.schema.json` — campos universais first-class + `payload_raw` verbatim. O gateway é a peça responsável por preencher os universais a partir do contrato de cada origem.

Este é o **primeiro serviço TypeScript** do monorepo (até aqui só Python via `uv`). O track estabelece também o toolchain Node (npm, Dockerfile Node) e a esteira CI para imagem não-Python.

## User Story

As a sistema ITSM da Locaweb (e o producer mock que o simula), I want to postar um evento de incidente em `POST /webhook/incidents` so that ele entra no barramento `incidents.raw` normalizado, sem cada origem precisar conhecer o schema interno.

As a engenheiro do pipeline, I want to que o gateway seja a única peça que normaliza payload de origem so that trocar/adicionar origens (alertmanager, datadog) não toca no consumer nem nos marts.

## Acceptance Criteria

- [ ] Serviço Fastify roda como `Deployment` no `ns: ui`, com `/health` (liveness/readiness) e `/metrics` (Prometheus)
- [ ] `POST /webhook/incidents` valida o corpo com Zod (adapter ITSM), normaliza para o schema `incidents.raw` e publica no tópico Kafka `incidents.raw`
- [ ] Mapeamento ITSM → universais: `event_id`=UUID v4 gerado · `source`=`source` do payload · `received_at`=timestamp do gateway (UTC) · `opened_at`=`aberto_em` normalizado ISO 8601 · `severity`=`prioridade_codigo` · `entity_id`=`item_configuracao` · `status`=`status` · `payload_raw`=JSON verbatim dos 27 campos
- [ ] Assinatura HMAC verificada no header; segredo via ESO/Vault → Secret K8s; verificação desativável por env em dev
- [ ] `scripts/incident_producer.py` assina o request quando o segredo HMAC está configurado
- [ ] NetworkPolicy permite `ns: ui` → `ns: data` na porta do Kafka (9092)
- [ ] Fluxo completo `producer → gateway → incidents.raw → consumer → ClickHouse` roda verificado no cluster via GitOps
- [ ] Erros mapeados: 401 (HMAC inválido), 422 (Zod falha), 502 (Kafka indisponível); publicação idempotente por `event_id`

## Dependencies

- **Pipeline de Dados** (`data-pipeline_20260529`) — tópico `incidents.raw`, contrato `contracts/incidents-raw.schema.json` e consumer `apps/data-ingest` (#45)
- **Infra base** (`k8s-infra_20260514`) — Kafka (Strimzi), ESO/Vault, ArgoCD, esteira Gitea Actions
- Substitui o stub nginx em `infra/charts/ui-gateway` + `infra/apps/ui-gateway.yaml`

## Out of Scope

- **Saída / fan-out** de `recommendations` para Slack/OpsGenie — depende do `agent` (Track futuro)
- **Callbacks** `/actions/callback`, `/slack/actions` e publicação em `actions.taken` — mesmo motivo
- **API pública** `/api/v1/*` com OpenAPI gerado de Zod
- Adapters além do ITSM (alertmanager, datadog) — interface preparada, implementação depois
- Re-inferência de recategorização (é o `model-serving` que detecta transição, não o gateway)
- Ingress TLS/cert-manager de produção — dev usa o Ingress traefik já existente

## Technical Notes

- **Stack:** Node 22 + TypeScript, **Fastify**, **Zod** (validação in/out), **kafkajs** (producer). `npm` como package manager (`package-lock.json`, `npm ci`). App em `apps/gateway/` — primeiro membro não-`uv` do monorepo.
- **Convenção repo→K8s:** natureza `deployment` em `apps/gateway/chart/app.yaml` (`namespace: ui`); overlay colocado (`values-dev.yaml`, `values-image.yaml`). Base chart em `infra/charts/ui-gateway` (reescrito de stub para o app real). ArgoCD app migra de single-source para multi-source com write-back de tag (padrão `data-ingest`).
- **Adapter pattern:** interface `SourceAdapter` (payload de origem → `IncidentRaw`); só `itsmAdapter` implementado. O handler resolve o adapter por `source` e delega a normalização.
- **Schema in (ITSM):** `{ incidente_id, source, aberto_em, prioridade_codigo, item_configuracao, status, payload }` — shape que o `incident_producer.py` já envia. `payload` (27 campos) vira `payload_raw` como string JSON.
- **Kafka:** `ops-ahead-kafka-bootstrap.data.svc.cluster.local:9092`, tópico `incidents.raw`, `key = event_id`. Producer com `acks=all` e retry.
- **HMAC:** header `X-Signature: sha256=<hmac(body)>`, segredo compartilhado. Env `HMAC_ENABLED=false` em dev libera o loop sem assinatura; producer passa a assinar quando `HMAC_SECRET` estiver setado.
- **CI:** Gitea Actions ganha job de build da imagem Node (Dockerfile multi-stage npm), push pro registry interno, write-back de `tag=SHA` em `apps/gateway/chart/values-image.yaml`.
- **Observabilidade:** `/metrics` via prom-client — contadores de eventos publicados, falhas HMAC, falhas Kafka; anotações `prometheus.io/scrape`.

---

_Generated by Conductor. Review and edit as needed._
