# Implementation Plan: Gateway de Ingestão (Motor de Integração)

**Track ID:** gateway-ingest_20260802
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-02
**Status:** [~] In Progress

## Overview

Cinco fases: primeiro bootstrap do app a partir do `src/` e do toolchain do template
`thiagon/template-fastify`; depois o módulo `incidents` (Zod 4 + adapter ITSM);
então os plugins de Kafka e HMAC; em seguida o empacotamento K8s/GitOps substituindo o
stub; por fim a verificação e2e no cluster. TDD moderado — testes vitest junto do núcleo
(normalização, HMAC, adapter), seguindo o layout `unit`/`e2e` do template.

## Phase 1: Bootstrap do app a partir do template

Trazer o `src/` e o toolchain do `template-fastify` para `apps/gateway/` e trocar a identidade.
Fica de fora o que é de repo standalone (LICENSE, `.github/`, docker-compose, README próprio).

### Tasks

- [x] Task 1.1: Portar o `src/` do template (`/home/thiago/workspace/sample_fastify`) para `apps/gateway/` sem o módulo de referência `todos/`; trazer toolchain (biome, vitest, tsconfig, Dockerfile, `.nvmrc`); ajustar `package.json` (name `@ops-ahead/gateway`), `.env.example` e `SERVICE_NAME`
- [x] Task 1.2: Excluir `apps/gateway` do workspace uv no `pyproject.toml` raiz; `npm install` gera `package-lock.json`; `npm run build`, `npm run typecheck`, `npm run lint` e `npm test` passam
- [x] Task 1.3: Estender `src/env.ts` com `KAFKA_BOOTSTRAP_SERVERS`, `KAFKA_TOPIC`, `HMAC_ENABLED`, `HMAC_SECRET`; validação de env passa
- [x] Task 1.4: Confirmar Dockerfile do template (`node:24-trixie-slim`, stages base/deps/build/prod) builda a imagem; container sobe e responde `/health`

### Verification

- [x] `npm ci && npm run build && npm test` passam; container sobe local e responde `/health` e `/docs`

## Phase 2: Módulo `incidents` (Zod 4 + adapter ITSM)

Contrato de entrada/saída e a normalização para `incidents.raw`, no layout de módulo do template.

### Tasks

- [x] Task 2.1: `src/modules/incidents/schema.ts` — `incidentRawSchema` (saída, alinhado a `contracts/incidents-raw.schema.json`), `itsmWebhookSchema` (entrada = shape do `incident_producer.py`) e os schemas da rota (body, aceite, erro)
- [x] Task 2.2: `service.ts` — interface `SourceAdapter` + `itsmAdapter`: `event_id`=UUID v4, `opened_at` normalizado ISO 8601 UTC, `severity`=`prioridade_codigo`, `entity_id`=`item_configuracao`, `payload_raw`=JSON verbatim; saída validada pelo `incidentRawSchema`; resolução de adapter por `source`
- [x] Task 2.3: `routes.ts` + `index.ts` — `POST /webhook/incidents` com `withTypeProvider<ZodTypeProvider>`, schema Zod (body/response), tags OpenAPI; 400 source desconhecido, 422 validação
- [x] Task 2.4: Testes vitest (`test/unit/modules/incidents/*`) — mapeamento, bordas de data/severity, adapter desconhecido; e2e do handler para um evento do CSV

### Verification

- [x] Testes cobrem mapeamento e validação; handler devolve o `IncidentRaw` correto para um evento do CSV; rota aparece no `/docs`

## Phase 3: Plugins Kafka + HMAC

Publica no barramento e protege a fronteira, como plugins autoload do template.

### Tasks

- [ ] Task 3.1: `src/plugins/kafka.ts` — producer `kafkajs` que decora `app.kafka`, conecta no `onReady`, encerra no `onClose`; publica em `incidents.raw`, `key=event_id`, `acks=all`, retry
- [ ] Task 3.2: Ligar o `service`/rota ao producer; erro 502 quando Kafka indisponível; incrementa métricas (publicados, falhas)
- [ ] Task 3.3: `src/plugins/hmac.ts` — hook `preValidation` verifica `X-Signature: sha256=…`, toggle `HMAC_ENABLED`, erro 401; testes
- [ ] Task 3.4: `src/plugins/metrics.ts` — prom-client expõe `/metrics` (contadores publicados, falhas HMAC, falhas Kafka)
- [ ] Task 3.5: `scripts/incident_producer.py` assina o request quando `HMAC_SECRET` está setado

### Verification

- [ ] Testes: assinatura válida/inválida, toggle off; publica contra Kafka local/mock e confirma mensagem no tópico; `/metrics` expõe os contadores

## Phase 4: Empacotamento K8s + GitOps

Substitui o stub nginx pelo app real na convenção atual.

### Tasks

- [ ] Task 4.1: Reescrever `infra/charts/ui-gateway` — Deployment (app real, porta do template), Service, Ingress, probes `/health`, scrape `/metrics`, securityContext
- [ ] Task 4.2: `NetworkPolicy` liberando `ns: ui` → `ns: data` na 9092 (Kafka)
- [ ] Task 4.3: `apps/gateway/chart/` — `app.yaml` (`workload: deployment`, `namespace: ui`), `values-dev.yaml`, `values-image.yaml`
- [ ] Task 4.4: Migrar `infra/apps/ui-gateway.yaml` para multi-source com `$values` (padrão `data-ingest`)
- [ ] Task 4.5: `ExternalSecret` do segredo HMAC (ESO/Vault) → Secret K8s; `HMAC_SECRET` no `.env`/dev-up
- [ ] Task 4.6: Adicionar `gateway` à matriz de build do CI (Gitea Actions) — build imagem Node (npm), push registry interno, write-back `tag=SHA`

### Verification

- [ ] `helm template` renderiza sem erro; CI builda e faz push da imagem; ArgoCD sincroniza o app novo

## Phase 5: Integração e verificação e2e

### Tasks

- [ ] Task 5.1: Deploy via GitOps (push → ArgoCD sync); pod `gateway` saudável no `ns: ui`
- [ ] Task 5.2: Rodar `incident_producer.py --gateway-url <ingress> --limit N` contra o gateway
- [ ] Task 5.3: Confirmar eventos em `incidents.raw` drenados pelo consumer para ClickHouse (contagem coerente)

### Verification

- [ ] Fluxo `producer → gateway → incidents.raw → consumer → ClickHouse` verificado no cluster

## Final Verification

- [ ] Todos os acceptance criteria atendidos
- [ ] Testes passando
- [ ] Stub nginx removido; gateway real no ar
- [ ] Pronto para review

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
