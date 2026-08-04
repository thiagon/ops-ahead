# Specification: Gateway de Ingestão (Motor de Integração)

**Track ID:** gateway-ingest_20260802
**Type:** Feature
**Created:** 2026-08-02
**Status:** Draft

## Summary

Construir a entrada do **Motor de Integração** (`gateway`, `ns: ui`): um serviço TypeScript + Fastify que expõe `POST /webhook/incidents`, valida assinatura HMAC, normaliza o payload do ITSM para o schema universal `incidents.received` e publica no Kafka. Substitui o stub nginx atual e fecha o loop de ingestão `producer → gateway → incidents.received → consumer` (consumer já entregue no #45).

## Context

A arquitetura da Sprint 2 (`docs/sprints/sprint-2-architecture.md` §3.4) define o `gateway` como a **fronteira HTTP externa** da solução, em TypeScript + Fastify no `ns: ui`. O fluxo end-to-end (§4) começa em `T+0s` com o ITSM emitindo `POST /webhook/incidents` — o gateway valida HMAC, normaliza e publica em `incidents.received`.

Hoje esse endpoint não tem servidor: o `scripts/incident_producer.py` (mock) já faz `POST /webhook/incidents`, e o consumer (`apps/data-ingest`, #45) já drena `incidents.received` para ClickHouse + MinIO. O meio está vazio. O `incidents.received` tem contrato **híbrido** versionado em `contracts/incident-event.schema.json` — campos universais first-class + `payload_raw` verbatim. O gateway é a peça responsável por preencher os universais a partir do contrato de cada origem.

Este é o **primeiro serviço TypeScript** do monorepo (até aqui só Python via `uv`). Ele é bootstrapado a partir do template `thiagon/template-fastify` — que já define o toolchain Node (Node 24, npm, Fastify 5 + Zod 4 + autoload, Biome, vitest, Dockerfile). O track adapta esse template ao domínio e estabelece a esteira CI para imagem não-Python.

## User Story

As a sistema ITSM da Locaweb (e o producer mock que o simula), I want to postar um evento de incidente em `POST /webhook/incidents` so that ele entra no barramento `incidents.received` normalizado, sem cada origem precisar conhecer o schema interno.

As a engenheiro do pipeline, I want to que o gateway seja a única peça que normaliza payload de origem so that trocar/adicionar origens (alertmanager, datadog) não toca no consumer nem nos marts.

## Acceptance Criteria

- [ ] Serviço Fastify roda como `Deployment` no `ns: ui`, com `/health` (liveness/readiness) e `/metrics` (Prometheus)
- [ ] `POST /webhook/incidents` valida o corpo com Zod (adapter ITSM), normaliza para o schema `incidents.received` e publica no tópico Kafka `incidents.received`
- [ ] Mapeamento ITSM → universais: `event_id`=UUID v4 gerado · `source`=`source` do payload · `received_at`=timestamp do gateway (UTC) · `opened_at`=`aberto_em` normalizado ISO 8601 · `severity`=`prioridade_codigo` · `entity_id`=`item_configuracao` · `status`=`status` · `payload_raw`=JSON verbatim dos 27 campos
- [ ] Assinatura HMAC verificada no header; segredo via ESO/Vault → Secret K8s; verificação desativável por env em dev
- [ ] `scripts/incident_producer.py` assina o request quando o segredo HMAC está configurado
- [ ] NetworkPolicy permite `ns: ui` → `ns: data` na porta do Kafka (9092)
- [ ] Fluxo completo `producer → gateway → incidents.received → consumer → ClickHouse` roda verificado no cluster via GitOps
- [ ] Erros mapeados: 401 (HMAC inválido), 422 (Zod falha), 502 (Kafka indisponível); publicação idempotente por `event_id`

## Dependencies

- **Pipeline de Dados** (`data-pipeline_20260529`) — tópico `incidents.received`, contrato `contracts/incident-event.schema.json` e consumer `apps/data-ingest` (#45)
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

- **Bootstrap a partir do template:** o app nasce do `thiagon/template-fastify` (cópia local em `/home/thiago/workspace/sample_fastify`). O gateway **adota as convenções do template** — não reinventa estrutura. Porta o `src/` e o toolchain (biome, vitest, tsconfig, Dockerfile, `.nvmrc`) para `apps/ui-gateway/` sem o módulo de referência `todos/`, e troca a identidade (`package.json` name, `SERVICE_NAME`). O que é de repo standalone — LICENSE, `.github/workflows`, docker-compose, README próprio — fica de fora: no monorepo isso é responsabilidade da esteira Gitea Actions e do `infra/`.
- **Stack (herdado do template):** Node **24** (`.nvmrc`), TypeScript executado nativo (type-stripping, sem `tsc` em dev), **Fastify 5**, **Zod 4**, **`fastify-type-provider-zod`** (validação in/out + OpenAPI), **`@fastify/autoload`** (plugins e módulos auto-registrados), `fastify-plugin`. Lint/format com **Biome** (não ESLint). Testes com **vitest** em projetos `unit`/`integration`/`e2e`. `npm` como package manager (`package-lock.json`, `npm ci`). App em `apps/ui-gateway/` — primeiro membro não-`uv` do monorepo (excluído do workspace uv no `pyproject.toml` raiz).
- **Estrutura (convenção do template):**
  - `src/env.ts` — schema Zod do env; plugin `src/plugins/config.ts` decora `app.env`. Estender com `KAFKA_*`, `HMAC_ENABLED`, `HMAC_SECRET`.
  - `src/app.ts` (`buildApp`), `src/server.ts` (entrypoint), plugins base do template: `config`, `cors`, `helmet`, `sensible`, `swagger`, `error-handler`, `close-with-grace`.
  - Módulo `src/modules/incidents/` (`index.ts`, `routes.ts`, `schema.ts`, `service.ts`) no lugar do `todos/` — expõe `POST /webhook/incidents`.
  - `/health` já vem do módulo `health` do template.
- **Adapter pattern:** interface `SourceAdapter` (payload de origem → `IncidentEvent`); só `itsmAdapter` implementado. A rota resolve o adapter por `source` e delega a normalização (vive no `service.ts` do módulo).
- **Schemas (Zod 4):** `incidentEventSchema` (saída, alinhado a `contracts/incident-event.schema.json`) e `itsmWebhookSchema` (entrada) no `schema.ts`. Entrada = `{ incidente_id, source, aberto_em, prioridade_codigo, item_configuracao, status, payload }`, shape que o `incident_producer.py` já envia. `payload` (27 campos) vira `payload_raw` como string JSON. `opened_at` = `aberto_em` normalizado ISO 8601 UTC.
- **Kafka:** producer `kafkajs` num plugin (`src/plugins/kafka.ts`) que decora `app.kafka`, conecta no `onReady` e encerra no `onClose`. Bootstrap `ops-ahead-kafka-bootstrap.data.svc.cluster.local:9092`, tópico `incidents.received`, `key = event_id`, `acks=all` + retry.
- **HMAC:** plugin/hook `preValidation` verifica `X-Signature: sha256=<hmac(body)>` com segredo compartilhado. Env `HMAC_ENABLED=false` em dev libera o loop sem assinatura; producer passa a assinar quando `HMAC_SECRET` estiver setado.
- **Observabilidade:** plugin `src/plugins/metrics.ts` com **prom-client** expõe `/metrics` — contadores de eventos publicados, falhas HMAC, falhas Kafka; anotações `prometheus.io/scrape` no Deployment. (O template traz Swagger em `/docs`, que fica.)
- **Convenção repo→K8s:** natureza `deployment` em `apps/ui-gateway/chart/app.yaml` (`namespace: ui`); overlay colocado (`values-dev.yaml`, `values-image.yaml`). Base chart em `infra/charts/ui-gateway` (reescrito de stub para o app real). ArgoCD app migra de single-source para multi-source com write-back de tag (padrão `data-ingest`).
- **CI:** Gitea Actions ganha o `gateway` na matriz de build (Dockerfile multi-stage `node:24-trixie-slim`, `npm ci`), push pro registry interno, write-back de `tag=SHA` em `apps/ui-gateway/chart/values-dev.yaml` (regra `<app>.image.tag`).

---

_Generated by Conductor. Review and edit as needed._
