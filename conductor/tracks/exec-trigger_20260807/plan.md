# Implementation Plan: Execução Sob Demanda (`ui-orchestrator` + KEDA)

**Track ID:** exec-trigger_20260807
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-14
**Revisado:** 2026-08-15
**Status:** Completo — implementação original (Fases 1–6) e revisão de arquitetura
(Fases 7–11, Kafka+KEDA no lugar de Argo Workflows) implementadas, verificadas no
cluster local e commitadas. 2026-08-16.

## Por que este plano muda depois de "completo"

A implementação original (commits `b76666d`..`b9c3034`, PR #53) completou as 6 fases
abaixo e passou pela validação E2E. Uma revisão pós-implementação (2026-08-15) encontrou
que o desenho violava o próprio princípio que a track se propunha a seguir — ver
"Histórico da revisão" no `spec.md`. Este plano documenta **o que já foi construído**
(Fases 1–6 originais, com seus checkpoints) e **o que a revisão substitui** (Fases 7–11,
novas) — não reescreve a história, adiciona a próxima etapa.

---

## Fases originais (completas, PR #53)

Resumo — detalhe task-a-task no histórico do git (`conductor/tracks/exec-trigger_20260807/`
antes desta revisão, recuperável via `git log -p -- conductor/tracks/exec-trigger_20260807/plan.md`).

| Fase | Entregou | Checkpoint |
|---|---|---|
| 1 | `apps/ml-trainer`, `apps/data-runner` — consolidação de 4 apps em 2, elimina duplicação de `split.py` | `405d61e` |
| 2 | `apps/trigger-service` — intake REST/MCP + consumer Kafka, 1 processo FastAPI | `b02ea96` |
| 3 | `ml-workflow-template`, extensão de `data-pipeline`, RBAC, tópico `trigger.requests` | `037a69d` |
| 4 | Deploy do `trigger-service` (chart, Application, Ingress, CI matrix) | `6d19164` |
| 5 | Remoção do fluxo `Job` manual antigo, documentação | `cdc87e3` |
| 6 | Validação ponta a ponta no cluster local | `b9c3034` |

**O que sobrevive intacto da Fase 1:** a consolidação de imagens em si (`ml-trainer`
rodando `train volume`/`train breach`, `data-runner` rodando `run transform`/
`run quality`, `split.py` único, testes migrados). A Fase 1 ganha tasks novas na Fase 7
abaixo — não é substituída, é estendida.

**O que a revisão substitui por completo:** Fases 2, 3, 4 — o `trigger-service` (app),
o `ml-workflow-template` (chart), a extensão `single-step` de `data-pipeline`, e o RBAC
de criação de `Workflow`. Fase 5 e 6 são refeitas contra a arquitetura nova.

---

## Fase 7: `ui-orchestrator` — intake Fastify (substitui a Fase 2)

Fronteira HTTP em Node/TypeScript, mesmo padrão de `apps/ui-gateway`: `zod` pra schema,
`kafkajs` pra publish, `@fastify/autoload` + `fastify-plugin` pra estrutura de módulos.
Só fala Kafka — nunca K8s/Argo.

### Tasks

- [x] 7.1: `apps/ui-orchestrator/` — scaffold Fastify seguindo `apps/ui-gateway` como
      template (`package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts` com
      projects unit/integration/e2e, `src/server.ts`, `src/app.ts` com autoload de
      `plugins/`+`modules/`)
- [x] 7.2: `src/env.ts` — schema zod de config (porta, Kafka bootstrap, nomes dos 3
      tópicos: `trigger.ml`, `trigger.data`, `trigger.status`)
- [x] 7.3: `src/plugins/kafka.ts` — producer (publica em `trigger.ml`/`trigger.data`
      conforme `analysis`) **e** consumer (`trigger.status`, compactado) no mesmo
      plugin — decorators `fastify.kafkaPublish`/estado interno do mapa `run_id→status`
- [x] 7.4: `src/modules/trigger/schema.ts` — `TriggerRequest` discriminado por
      `analysis` (`volume_forecast`|`breach_risk`|`data_refresh`|`data_quality_check`),
      zod, campos: `train_end`/`validation_end`/`holdout_end` obrigatórios pros dois
      primeiros, nenhum campo pros outros dois. **Sem `data_source`/override de origem
      de dado** — removido nesta revisão por risco de SSRF e vazamento de credencial
      (payload → Kafka → possível log de erro); ver [`payloads.md`](./payloads.md)
- [x] 7.5: `src/modules/trigger/service.ts` — mapa `analysis → tópico` (`ml`/`data`,
      só roteamento — `analysis` viaja intacto na mensagem, sem tradução pra vocabulário
      interno; ver [`payloads.md`](./payloads.md) sobre por que isso mudou de desenho)
      + geração de `run_id` (`crypto.randomUUID()`)
- [x] 7.6: `src/modules/trigger/routes.ts` — `POST /trigger`: valida, gera `run_id`,
      publica, responde `202 {run_id}`
- [x] 7.7: `src/modules/runs/routes.ts` — `GET /runs/{run_id}`: lookup no mapa em
      memória (populado pelo consumer de `trigger.status`); ausente ⇒ `queued`
- [x] 7.8: `src/modules/health/index.ts` — `GET /health`, mesmo padrão de
      `apps/ui-gateway`
- [x] 7.9: MCP — servidor hand-wired com `@modelcontextprotocol/sdk`, duas tools
      (`trigger_analysis`, `get_run_status`) chamando as mesmas funções de
      `modules/trigger/service.ts`/`modules/runs/service.ts` que as rotas REST usam
- [x] 7.10: Testes — mirror da estrutura de `apps/ui-gateway/test/` (unit: schema,
      service; e2e: rotas via `.inject()`, kafka fake/mock igual
      `test/unit/plugins/kafka.test.ts` já faz hoje)
- [x] 7.11: `Dockerfile` — mirror exato do `apps/ui-gateway/Dockerfile` (multi-stage
      `node:24-trixie-slim`)

### Verification

- [x] `npm test` (via `apps/ui-orchestrator`) passa — 43/43 (unit + e2e, incluindo
      roundtrip MCP real via SSE)
- [x] `POST /trigger` com payload malformado retorna `400`/`422`, nunca `500`
- [x] MCP e REST produzem o mesmo `run_id`/comportamento pro mesmo payload — ambos
      chamam `triggerAnalysis`/`getRunStatus`, sem lógica duplicada
- [ ] `ServiceAccount` do pod (quando existir, Fase 9) não tem nenhuma RBAC de K8s além
      do default — confirmado por inspeção do chart, não só por não ter código que
      chame a API

---

## Fase 8: `ml-trainer`/`data-runner` — modo consumidor (estende a Fase 1)

### Tasks

- [x] 8.1: `apps/ml-trainer/src/main.py` — novo modo `consume` (além do `train` já
      existente): conecta em `trigger.ml`, lê 1 mensagem
      (`analysis`/`train_end`/`validation_end`/`holdout_end` — sem override de fonte de
      dado, ver [`payloads.md`](./payloads.md)), traduz `analysis → volume`/`breach`
      **localmente** (tabela pequena dentro do próprio app, não em `ui-orchestrator`),
      publica `status: Running` em `trigger.status` ao começar, chama o mesmo
      `TRAINERS[...]` que o modo `train` já usa, publica o resultado final
      (`Succeeded`/`Failed` + `detail`) em `trigger.status` ao terminar
- [x] 8.2: `apps/data-runner/src/main.py` — novo modo `consume`: conecta em
      `trigger.data`, lê 1 mensagem (`analysis: data_refresh`/`data_quality_check`/
      `full_pipeline`), traduz `analysis → transform`/`quality` localmente, publica
      `status: Running` ao começar, despacha pro `STEPS[...]` existente **ou**, se
      `analysis: full_pipeline` (mensagem publicada pelo `CronJob` da Fase 9), roda os
      3 passos em sequência (`dbt run` → `great_expectations` suite `critical` →
      `register-snapshot`, este último portado do script inline que hoje vive em
      `infra/charts/data-pipeline/templates/workflowtemplate.yaml`); publica o
      resultado final em `trigger.status` ao terminar
- [x] 8.3: `register-snapshot` como código Python de verdade dentro de
      `apps/data-runner/src/` (hoje é um script inline no `WorkflowTemplate` que sai
      na Fase 10) — mesma lógica (hash SHA-256 dos counts dos marts, log no MLflow)
- [x] 8.4: Testes novos: modo `consume` de cada app (kafka fake injetado, mesmo padrão
      de `apps/trigger-service/tests/test_consumer.py` — que será removido na Fase 10,
      mas serve de referência de como mockar o client Kafka)

### Verification

- [x] `uv run --package ops-ahead-ml-trainer pytest apps/ml-trainer/tests` e
      `uv run --package ops-ahead-data-runner pytest apps/data-runner/tests` passam
      (29 e 21 testes respectivamente; rodar com o path explícito — sem ele o pytest
      descobre `tests/` de todos os apps a partir da raiz do repo e colide os
      namespaces `tests.*`, um problema pré-existente do monorepo, não desta track)
- [x] Mensagem malformada no tópico não derruba o processo (loga e sai com erro,
      KEDA cria um novo `Job` pra próxima mensagem) — `process_message` trata
      `KeyError`/`TypeError` sem propagar
- [x] Modo `analysis: full_pipeline` do `data-runner` produz o mesmo resultado (mesmos marts,
      mesmo snapshot no MLflow) que o `WorkflowTemplate` antigo produzia — lógica
      portada 1:1, testada contra um tracking store MLflow real (sqlite efêmero)

---

## Fase 9: KEDA + `ScaledJob`s + `CronJob` (substitui a Fase 3)

### Tasks

- [x] 9.1: `infra/charts/infra-keda/` (novo) — wrap do chart oficial `kedacore/keda`,
      mesmo padrão de `infra/charts/data-workflows` (que embrulha `argo-workflows`) ou
      `infra/charts/infra-eso`. Instalado 1x, `ns: infra`. `metricsServer.enabled: false`
      (só usamos `ScaledJob`, nunca `ScaledObject`/HPA) e `resources.webhooks` reduzido —
      a quota compartilhada de `ns: infra` (`limits.cpu: 16`) não tinha headroom pro
      default de 1 CPU de cada componente
- [x] 9.2: `infra/apps/infra-keda.yaml` — Application automated, sync-wave anterior a
      qualquer `ScaledJob`. `ServerSideApply=true` — o CRD `ScaledJob` é grande o
      bastante pra estourar o limite de 262144 bytes da anotação de client-side apply.
      `AppProject` (`infra/apps/project.yaml`) ganhou `apiregistration.k8s.io/APIService`
      no `clusterResourceWhitelist` (KEDA registra a métrica externa) e o repo do Helm
      chart no `sourceRepos`
- [x] 9.3: `infra/charts/ml-trainer` (novo, ao lado do app) — `ScaledJob` (trigger
      Kafka, tópico `trigger.ml`, `lagThreshold`), Job template rodando a imagem
      `ml-trainer` em modo `consume`. RBAC: nenhuma além do default — `ScaledJob` só
      precisa que o KEDA operator (já tem sua própria RBAC de plataforma) crie `Job`s.
      `apps/ml-trainer/chart/app.yaml` migrou de `workload: pipeline-step` pra
      `workload: scaledjob` (5ª natureza — ver nota na Fase 11); nova
      `infra/apps/ml-trainer.yaml` substitui `ml-workflow-template.yaml`
- [x] 9.4: `infra/charts/data-runner` (novo) — mesmo padrão, tópico `trigger.data`.
      Mesma migração de `workload` em `apps/data-runner/chart/app.yaml`; nova
      `infra/apps/data-runner.yaml`
- [x] 9.5: `CronJob` nativo (`ns: data`, dentro do chart de `data-runner`) — 02:00 UTC
      (`cron.schedule`/`cron.enabled` portados de `pipelines/data-itsm-daily/values.yaml`,
      que fica órfão — removido na Fase 10 junto com `data-pipeline`), container
      `edenhill/kcat:1.7.1` (sucessor do `cp-kafkacat`, descontinuado) publica 1 mensagem
      `{"run_id": "daily-<data>", "analysis": "full_pipeline"}` em `trigger.data` (`run_id`
      determinístico pela data) e sai
- [x] 9.6: Tópicos Kafka `trigger.ml`, `trigger.data` (regular),
      `trigger.status` (`cleanup.policy: compact`) em
      `infra/charts/data-kafka/values.yaml` **e** `values-dev.yaml` — substituem o
      `trigger.requests` da versão original

### Verification

- [x] `helm template infra/charts/infra-keda`, `infra/charts/ml-trainer`,
      `infra/charts/data-runner` renderizam sem erro (+ `helm lint` limpo nos 3)
- [x] `kubectl get scaledjob -A` mostra os 2 `ScaledJob`s depois do deploy — confirmado
      no cluster local via `make sync` (`ml-trainer`/`data-runner`, ambos `READY: True`);
      Vault precisou ser semeado na mão pros paths novos (`ml-trainer`, `data-runner` —
      mesma pegadinha de [`project_new_app_local_deploy_gotchas`])
- [x] Nenhum `Role`/`RoleBinding` novo referenciando `workflows.argoproj.io` ou
      qualquer recurso além do que o KEDA operator já tinha de fábrica — confirmado por
      `grep` nos charts e pela lista de recursos que o ArgoCD de fato sincronizou

---

## Fase 10: Deploy do `ui-orchestrator` + remoção do Argo Workflow (substitui a Fase 4)

### Tasks

- [x] 10.1: `infra/charts/ui-orchestrator/` — `Deployment`+`Service`+`HPA`, `ns: ui`,
      sem RBAC própria — `ServiceAccount` dedicada (nome fixo, sem token automontado),
      exatamente o padrão real de `ui-gateway` (que também não usa a `default` do
      namespace literalmente, mas uma SA sua sem nenhuma permissão)
- [x] 10.2: `apps/ui-orchestrator/chart/app.yaml` (`workload: deployment`,
      `namespace: ui`) + `values-dev.yaml`
- [x] 10.3: `infra/apps/ui-orchestrator.yaml` — Application automated, sync-wave depois
      de `data-kafka` e `infra-keda`
- [x] 10.4: `infra/apps/ingresses.yaml` — host `orchestrator.ops-ahead.localtest.me`
      (dev), mesmo padrão dos outros hosts; removida a Ingress de `argo-workflows`
      junto (chart saiu na 10.7)
- [x] 10.5: Hooks `PostSync` de health check — `Job` por serviço
      (`ui-orchestrator`/`ml-trainer`/`data-runner`), valida conectividade Kafka
      (+ClickHouse pros dois últimos), mesmo padrão do hook `PreSync` já usado por
      `data-ingest`
- [x] 10.6: CI matrix (`.gitea/workflows/build.yaml`) — troca `trigger-service` por
      `ui-orchestrator`
- [x] 10.7: **Removido**: `infra/charts/data-workflows`, `infra/apps/data-workflows.yaml`,
      `infra/charts/ml-workflow-template`, `infra/apps/ml-workflow-template.yaml`,
      `apps/trigger-service/` (app inteiro), `infra/charts/trigger-service`,
      `infra/apps/trigger-service.yaml`, `infra/charts/data-pipeline` (chart inteiro —
      nada sobrou além do que virou `ScaledJob`+`CronJob`), `pipelines/data-itsm-daily/`
      (órfão sem o chart), `infra/apps/pipelines-appset.yaml` (mecanismo geral também
      era só pra esse um pipeline), stub morto `infra/charts/data-kafka/templates/
      argo-rbac.yaml` e a chave `argoWorkflows` órfã em `data-kafka/values.yaml`

### Bugs encontrados e corrigidos rodando de verdade no cluster local

Validação ponta a ponta (`POST /trigger` real via Ingress, mensagem manual em
`trigger.data`) pegou dois bugs que `helm template`/testes unitários não pegariam:

- **`CLICKHOUSE_HOST`/`CLICKHOUSE_DATABASE` faltando no `ScaledJob` de `data-runner`** —
  `profiles.yml` do dbt lê essas env vars discretas via Jinja (`env_var(...)`), não
  `CLICKHOUSE_URL` — o `WorkflowTemplate` antigo já setava as duas, esqueci de portar.
  `dbt run` falhava tentando conectar em `localhost:8123`. `Settings` (Python) continua
  só com URL — isso é o dbt lendo direto do ambiente, fora do meu código.
- **`groupId` fixo no consumer de `trigger.status` do `ui-orchestrator`** — um `groupId`
  estável e compartilhado entre réplicas quebra dois jeitos: réplicas concorrentes
  dividem as partições entre si (cada uma só vê parte do histórico) e, num restart,
  o consumer resume do offset commitado em vez de reler o tópico do zero — o oposto do
  que a Fase 7 pretendia. Fix: `groupId` único por boot (`orchestrator-status-<uuid>`),
  nunca persistido. Efeito colateral descoberto junto: o timeout padrão de 10s do hook
  `onReady` do Fastify é curto demais pro join do consumer group sob latência real —
  subido pra 30s.
- **`ResourceQuota` de `ns: ui` sem espaço pro rollout** — HPA do `ui-orchestrator`
  (1-3 réplicas) mais `ui-gateway`/`ui-frontend` já rodando estourava o teto antigo de
  2 CPU assim que um rolling update precisava de pod velho + novo ao mesmo tempo
  (`FailedCreate`, `ReplicaFailure`). Subido pra 3 CPU / 3Gi — mesma classe de ajuste
  que `infra-keda` já tinha exigido em `ns: infra` na Fase 9.

### Verification

- [x] `helm template infra/charts/ui-orchestrator` renderiza sem erro (+ `helm lint`)
- [x] Push dispara CI, `ui-orchestrator` builda e publica imagem — confirmado, `ci: pin
      image tags to <sha>` chegou no `gitea/main` e o `Deployment` foi atualizado
- [x] `kubectl get applications -n infra` não lista mais `data-workflows`,
      `ml-workflow-template`, `trigger-service` — confirmado, prunados pelo
      `ops-ahead-root` depois da remoção dos manifests
- [x] **Além do checklist original** — fluxo completo validado no cluster local real:
      `POST /trigger` (via Ingress) → `trigger.data` → `ScaledJob` cria `Job` →
      `data-runner` roda `data_quality_check` contra ClickHouse de verdade (1055 linhas)
      → publica `Succeeded` em `trigger.status` → `GET /runs/{run_id}` reflete o
      resultado. `analysis: full_pipeline` (disparado pelo `CronJob` nativo, que
      calhou de bater 02:00 UTC durante o teste) também rodou ponta a ponta:
      `dbt run` (8 modelos, 0 erro) → suite `critical` → `register_snapshot` logou no
      MLflow (hash `36664b3e...`). Réplica nova do `ui-orchestrator` confirmada
      reidratando o histórico completo do zero ao subir.

---

## Fase 11: Docs + validação E2E (substitui as Fases 5 e 6)

### Tasks

- [x] 11.1: `docs/data-pipeline.md` reescrito — a seção "Rerodar um step isolado"
      passa a descrever o `ui-orchestrator`; a cadeia completa deixa de ter uma seção
      "via Argo CLI" e ganha "via `CronJob`" (automático) + "manual" (publicar direto
      no tópico — `full_pipeline` não é exposto por `POST /trigger`, é vocabulário só
      do `CronJob`)
- [x] 11.2: `apps/ui-orchestrator/README.md` — mesmo conteúdo que
      `apps/trigger-service/README.md` tinha, nomes/exemplos atualizados
- [x] 11.3: `CLAUDE.md` raiz — seção "Workload natures" reescrita (5ª natureza
      `scaledjob`, remove `pipeline-step`/`pipelines/`, explica o caminho sob demanda
      e a cadeia diária como o mesmo mecanismo); nota adicional sobre o `groupId`
      único por boot (achado real da validação) e correção do exemplo de `uv run
      --package` (não escopa `pytest` sozinho — path explícito é necessário)
- [x] 11.4: `README.md`, `infra/scripts/README.md` — remove referências a
      `trigger-service`/`data-workflows`, adiciona `ui-orchestrator`/`infra-keda`
- [x] 11.5: `domain/ubiquitous-language.md` + `domain/context-map.md` — confirmado sem
      nenhuma referência residual a `trigger-service`/`data-workflows`/Argo (já feito
      na revisão de spec, commit `a07d932`)
- [x] 11.6: Disparados os 4 tipos de `analysis` via `ui-orchestrator` no cluster local
      (REST, pela Ingress real) — `data_quality_check`, `data_refresh`,
      `volume_forecast`, `breach_risk`, todos com `run_id` próprio. `GET /runs/{run_id}`
      refletiu o status publicado em todos; `volume_forecast`/`breach_risk` rodaram em
      `Job`s separados e concorrentes (`ml-trainer-k6g87`/`ml-trainer-nmmhk`),
      confirmando isolamento. Os dois falharam — `ValueError: temporal_split produced
      empty partition(s)` — mas isso é o dataset local não cobrir as datas de exemplo
      de `payloads.md`, não um bug: o mecanismo (roteamento, `Job` isolado, captura de
      exceção, `status: Failed` com `detail` publicado, saída limpa) funcionou
      exatamente como desenhado. Ver `docs/insights/temporal-split-data-dependency.md`
      — problema pré-existente e fora do escopo desta track
- [x] 11.7: `CronJob` confirmado — bateu 02:00 UTC durante a própria validação
      (`data-runner-daily-29780760`, coincidência de horário) e rodou a cadeia
      completa: `dbt run` (8 modelos, 0 erro) → suite `critical` → `register_snapshot`
      logou no MLflow real (hash `36664b3e5afe3162ff1e967c91b0309d9913c24f6dc4b0031ffb72504b042080`)

### Verification

- [x] Critérios de aceite do `spec.md` revisado verificados no cluster local — ponto a
      ponto:
  - [x] Ponto de entrada único (REST+MCP, mesmo contrato) sem kubeconfig/Argo/K8s
  - [x] Payload em linguagem de negócio (`analysis` + parâmetros), nunca infra
  - [x] `ServiceAccount` de `ui-orchestrator`/`ml-trainer`/`data-runner` sem RBAC além
        do default — confirmado por inspeção dos charts (nenhum `Role`/`RoleBinding`
        renderizado) e pelos recursos que o ArgoCD de fato sincronizou
  - [x] Parâmetros só do payload, nada hardcoded em `values.yaml`
  - [x] `Job` isolado por requisição via KEDA — confirmado (dois `Job`s concorrentes,
        um falhando sem afetar o outro)
  - [x] Os 4 tipos de `analysis` rodam pelo mecanismo, nunca mais `argo submit`
  - [x] Disparo diário usa o mesmo caminho do disparo sob demanda — confirmado
        (`full_pipeline` via `CronJob`, mesmo `ScaledJob`/consumer que o sob demanda)
  - [x] Assíncrono ponta a ponta — `202 {run_id}` na hora, `GET /runs` reflete o que o
        job publica
  - [x] `GET /runs/{run_id}` sobrevive a restart — confirmado: réplica nova do
        `ui-orchestrator` (rollout do fix de `groupId`) reidratou o histórico completo
        do zero antes de responder tráfego
- [x] `grep -r` por `argo submit`, `WorkflowTemplate`, `CronWorkflow` fora de
      `docs/insights/`/`conductor/`/histórico do git: só comentários de código
      explicando proveniência (o que foi portado/removido e por quê) — nenhuma
      referência funcional viva

---

## domain/ e contracts/ (feito nesta sessão, direto nos arquivos — não depende do código)

- `domain/ubiquitous-language.md` — termo `analysis` e os 4 valores de negócio
  (`full_pipeline` não entra aqui — nunca é escolhido por um caller, é vocabulário só do
  `CronJob`).
- `domain/context-map.md` — tipo de integração request/response sob demanda + tópicos
  `trigger.ml`/`trigger.data`/`trigger.status`.
- `contracts/trigger-ml.schema.json`, `contracts/trigger-data.schema.json`,
  `contracts/trigger-status.schema.json` — JSON Schema formal dos 3 tópicos, mesmo
  padrão de `contracts/incident-event.schema.json`. Fonte de verdade; `payloads.md` é a
  leitura narrada com exemplos.

---

## Checkpoints

| Fase | Checkpoint SHA | Data | Status |
|---|---|---|---|
| 1 | `405d61e` | 2026-08-14 | completa |
| 2 | `b02ea96` | 2026-08-14 | completa, **substituída pela Fase 7** |
| 3 | `037a69d` | 2026-08-14 | completa, **substituída pela Fase 9** |
| 4 | `6d19164` | 2026-08-14 | completa, **substituída pela Fase 10** |
| 5 | `cdc87e3` | 2026-08-15 | completa, **refeita na Fase 11** |
| 6 | `b9c3034` | 2026-08-15 | completa, **refeita na Fase 11** |
| 7–11 | — | — | não iniciadas |
