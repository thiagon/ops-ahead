# Specification: Execução Sob Demanda (`ui-orchestrator` + KEDA)

**Track ID:** exec-trigger_20260807
**Type:** Feature
**Created:** 2026-08-07
**Revised:** 2026-08-15 — redesenho pós-revisão, ver "Histórico da revisão" abaixo
**Status:** Draft (revisão)

## Summary

Um **ponto de entrada único, em linguagem de negócio**, que recebe um payload tipado e
validado (`analysis` + parâmetros — datas de corte, etc.) e faz uma
análise rodar, sem que quem chama (dev, N1, agente de IA) precise de kubeconfig, Argo CLI
ou qualquer conhecimento de cluster. Substitui o fluxo manual antigo (`argo submit`,
`argocd app sync`, `kubectl delete job`) e as datas/config hardcoded em `values.yaml`.

**Princípio central #1** (inalterado desde a versão original): quem chama não sabe — nem
precisa saber — que existe Kubernetes, Kafka ou qualquer motor de execução por trás. O
pedido é feito em linguagem de negócio ("quero uma previsão de volume pra esse período"),
não em linguagem de infraestrutura.

**Princípio central #2** (reescrito nesta revisão): **nenhum app custom deste sistema
fala com a API do Kubernetes ou do Argo — nem pra criar recurso, nem pra ler status.**
Isso é mais forte que a garantia original ("um único ponto que fala com o cluster") — a
versão original ainda tinha *um* processo (o antigo `trigger-service`) com uma
`ServiceAccount` capaz de criar `Workflow`s, montada o tempo todo. A revisão eliminou
esse processo: quem fala com o Kubernetes agora é exclusivamente infraestrutura de
plataforma (KEDA, criando `Job`s nativos) — nunca código de aplicação que o time escreve
e mantém. O único canal entre os componentes de aplicação é Kafka.

## Histórico da revisão (2026-08-15)

A implementação original (Fases 1–6, ver Checkpoints no `plan.md`) construiu um serviço
único (`trigger-service`, FastAPI) que validava o payload, publicava num tópico Kafka, e
*ele mesmo* consumia esse tópico e criava um `Workflow` do Argo via client Kubernetes,
segurando uma `ServiceAccount` com `create` em `workflows.argoproj.io` o tempo todo.

Revisão pós-implementação encontrou três problemas, cada um puxando o fio do próximo:

1. **`trigger-service` é vocabulário de infra** — viola o próprio Princípio central #1,
   e é o único app do repo sem prefixo de domínio.
2. **Esse serviço segurava uma credencial de K8s/Argo sensível dentro de código de
   aplicação**, rodando pra sempre num `Deployment`. Cogitado e descartado: Argo Events
   (um `Sensor` *também* é um `Deployment` de longa duração com a credencial sempre
   montada — não reduz a exposição, só troca quem escreveu o código que a usa).
3. Consequência de levar (2) até o fim: se **nenhum** app pode ter uma credencial de
   K8s/Argo, então o próprio `Workflow`/`WorkflowTemplate` do Argo deixa de fazer
   sentido no caminho sob demanda — precisa de algo que *crie* o recurso, e esse algo
   sempre seria um app com a credencial. A alternativa é deixar uma peça de
   infraestrutura (não um app) criar o recurso de execução diretamente: **KEDA
   `ScaledJob`**, que escala `Job`s nativos do Kubernetes a partir do lag de um tópico
   Kafka — sem nenhum app segurando `create` de nada.
4. Levando isso ao limite: se o disparo sob demanda não precisa mais de Argo Workflow,
   o disparo *agendado* (cron) também não precisa — a cadeia diária
   (`dbt-run → great-expectations → register-snapshot`), hoje um `CronWorkflow`, vira
   um `CronJob` nativo do Kubernetes que publica um evento no Kafka no horário certo,
   atendido pelo mesmo mecanismo do disparo sob demanda. **O motor Argo Workflows
   inteiro (`infra/charts/data-workflows`) sai do stack** — não só o que esta track
   adicionou, mas a arquitetura de pipeline que já existia antes dela.

Essa última consequência extrapola o escopo original desta track (ela herda e reverte
uma decisão de arquitetura anterior a ela, do `data-pipeline`) — registrado aqui porque é
o resultado direto de levar o Princípio central #2 a sério, não um objetivo à parte.

## Architecture

```
caller (dev / N1 / agente IA)
   │  POST /trigger (REST)  ou  MCP tool call
   ▼
ui-orchestrator (Fastify/Node, ns: ui)      valida payload (zod), gera run_id,
   │                                         publica em trigger.ml ou trigger.data
   │                                         (conforme `analysis`), responde 202
   │                                         {run_id} na hora — mesmo padrão de
   │                                         apps/ui-gateway (zod, kafkajs, autoload,
   │                                         módulos routes/schema/service)
   ▼
Kafka: trigger.ml  /  trigger.data           2 tópicos, um por domínio — cada mensagem
                                              leva `analysis` + parâmetros + `run_id`
   │                                    │
   ▼                                    ▼
KEDA ScaledJob (ml)              KEDA ScaledJob (data)     0→N conforme o lag do
   │                                    │                  tópico — infraestrutura de
   │                                    │                  plataforma (infra/charts/
   │                                    │                  infra-keda, operator, 1x,
   │                                    │                  mesmo padrão de infra-eso),
   │                                    │                  nunca código de app
   ▼                                    ▼
Job → ml-trainer                 Job → data-runner
   consome 1 msg de                   consome 1 msg de trigger.data (`analysis` +
   trigger.ml (`analysis` +            parâmetros), traduz localmente pra transform/
   datas), traduz localmente           quality OU, se veio do cron (`analysis:
   pra volume/breach, roda,            full_pipeline`), os 3 passos em sequência
   publica status                      (dbt-run → great-expectations →
                                        register-snapshot); publica status ao terminar
   │                                    │
   └──────────────┬─────────────────────┘
                   ▼
   Kafka: trigger.status (compactado — cleanup.policy=compact, key=run_id)
                   ▲
GET /runs/{run_id} ┘  ui-orchestrator: lookup num mapa em memória, rehidratado desse
                       tópico no startup e mantido ao vivo depois — nunca toca K8s

CronJob nativo (ns: data, 02:00 UTC) ──publica evento──▶ trigger.data (mesmo caminho)
```

Cada serviço (`ui-orchestrator`, `ml-trainer`, `data-runner`) ganha um `Job` de hook
`PostSync` no deploy, que valida conectividade (Kafka, ClickHouse, etc.) e falha o sync
do ArgoCD se a configuração estiver errada — mesmo padrão do hook `PreSync` que a esteira
CI (Gitea Actions) já usa.

**Nada neste diagrama, além de KEDA (peça de plataforma) e o `CronJob` nativo, cria ou lê
recursos do Kubernetes.** Todo o resto fala Kafka.

## Context

Do `product.md`: a plataforma prevê volume de incidentes (D+1/D+7) e risco de breach de
OLA pra operação da Locaweb — os dois modelos de ML (`ml-volume-model`/`ml-breach-model`
originais, hoje `ml-trainer`) são o coração disso.

Ao rodar a Fase 5 (validação ponta a ponta) da track `ml-models_20260806` com o cluster
local no ar pela primeira vez, dois problemas de fundo apareceram (documentados em
`docs/insights/temporal-split-data-dependency.md`):

1. **Datas de split hardcoded pra um dataset específico.** Qualquer subconjunto, dataset
   sintético, ou range de datas diferente quebrava o treino.
2. **Re-disparar uma execução exigia comandos manuais direto no cluster** —
   `kubectl delete job` + `argocd app sync` (ou `argo submit` direto).

O objetivo maior continua o mesmo da versão original: o sistema está amarrado a um
dataset e uma empresa (Locaweb) hoje; a visão de produto é um ecossistema plugável por
qualquer empresa no futuro, o que exige que toda execução seja parametrizada por
payload, não hardcoded em config estática.

## User Story

- Como **dev do time**, eu quero disparar um treino/pipeline com parâmetros customizados
  sem precisar de acesso direto ao cluster, para que eu possa iterar rápido.
- Como **N1/operação**, eu quero disparar uma execução sob demanda através de uma
  interface simples, sem entender a infraestrutura por trás.
- Como **agente de IA**, eu quero chamar uma tool MCP nativa com os parâmetros que
  preciso, sem montar uma chamada HTTP manualmente.
- Como **empresa cliente futura**, eu quero configurar meus próprios dados/parâmetros
  nesse mesmo mecanismo, sem depender do dataset específico da Locaweb.
- **Novo nesta revisão** — como **responsável pela segurança da plataforma**, eu quero
  que nenhum processo de aplicação segure uma credencial capaz de criar recursos no
  Kubernetes, para que um bug ou uma dependência comprometida em código de negócio nunca
  vire um caminho de escalação pro cluster.

## Acceptance Criteria

- [ ] Existe um ponto de entrada único (REST + MCP, mesmo contrato) que aceita um
      payload tipado e validado e faz uma análise rodar, sem kubeconfig nem
      conhecimento de Argo/K8s por parte de quem chama.
- [ ] O contrato do payload é escrito em linguagem de negócio (`analysis` + parâmetros),
      nunca em termos de Kubernetes/Argo/Kafka.
- [ ] **Nenhum processo de aplicação (`ui-orchestrator`, `ml-trainer`, `data-runner`)
      tem uma `ServiceAccount`/RBAC capaz de ler ou escrever qualquer recurso do
      Kubernetes.** `kubectl get serviceaccount -o yaml` nos três não deve mostrar
      nenhuma permissão além do default do namespace.
- [ ] Todos os parâmetros de uma execução vêm do payload da requisição — nada fica
      hardcoded em `values.yaml`/chart.
- [ ] Cada requisição dispara um `Job` isolado e efêmero (via KEDA); uma execução
      falhando não trava nem interfere em outra execução concorrente.
- [ ] `volume_forecast`, `breach_risk`, `data_refresh`, `data_quality_check` rodam
      através desse mecanismo — nunca mais `argo submit`/`kubectl delete job` manual.
- [ ] O disparo diário agendado (antigo `CronWorkflow`) usa o **mesmo** caminho de
      execução do disparo sob demanda — não um mecanismo paralelo.
- [ ] O disparo é assíncrono ponta a ponta: `POST /trigger`/tool MCP responde
      imediatamente com um `run_id`; `GET /runs/{run_id}` reflete o status publicado
      pelo próprio job em `trigger.status`, sem consultar o Kubernetes.
- [ ] `GET /runs/{run_id}` sobrevive a um restart do `ui-orchestrator` sem perder
      histórico de runs já concluídos (rehidratação do tópico compactado).

## Dependencies

- **KEDA** (`infra/charts/infra-keda`, novo) — autoscaler orientado a evento; escala os
  `ScaledJob`s de `ml-trainer`/`data-runner` a partir do lag dos tópicos Kafka. Instalado
  uma vez, mesmo padrão de `infra-eso`.
- Kafka (`ns: data`, já usado por `data-ingest`/`ml-burst-detector`) — 3 tópicos novos:
  `trigger.ml`, `trigger.data` (pedidos, um por domínio — necessário porque KEDA não
  filtra por conteúdo da mensagem, só por volume da fila) e `trigger.status`
  (compactado, `key=run_id` — funciona como o "estado atual" de cada run sem precisar de
  Redis/banco).
- Charts de `ml-trainer`/`data-runner` (Fase 1 desta track) — ganham um modo de consumo
  Kafka e um `ScaledJob` como workload próprio.
- Track `ml-models_20260806` — criou os dois treinos de ML que essa feature dispara;
  status: em andamento.

## Removido nesta revisão

- **`infra/charts/data-workflows`** (motor Argo Workflows) — sem uso depois que o cron
  também migra pra Kafka+KEDA. Pré-existia esta track; a revisão o reverte.
- **`infra/charts/ml-workflow-template`** — só existia pro caminho sob demanda via
  `Workflow`, que não existe mais.
- **`WorkflowTemplate`/`CronWorkflow`** de `infra/charts/data-pipeline` — a cadeia
  completa vira um script sequencial dentro do `Job` de `data-runner`, disparado por um
  `CronJob` nativo em vez do `CronWorkflow`.

## Out of Scope

- Multi-tenancy de verdade (isolamento de dados/config por empresa, autenticação por
  cliente) — inalterado da versão original.
- Autenticação/autorização do ponto de entrada — inalterado.
- Reintroduzir Argo Workflows por qualquer motivo que não seja uma necessidade real de
  orquestração multi-step com fan-out/fan-in — o caso de uso atual (cadeias lineares,
  passo único) não precisa disso.

## Technical Notes

- **`ui-orchestrator` é Fastify/TypeScript, não Python/FastAPI** — segue
  `apps/ui-gateway` como precedente direto: mesmas libs (`fastify`, `zod` +
  `fastify-type-provider-zod`, `kafkajs`, `@fastify/autoload`, `fastify-plugin`), mesmo
  padrão de módulo (`routes.ts`/`schema.ts`/`service.ts`), mesmo `Dockerfile` multi-stage
  Node. MCP é hand-wired sobre o `@modelcontextprotocol/sdk` oficial, reusando as mesmas
  funções de `service.ts` que as rotas REST chamam (sem duplicar validação/lógica) —
  não existe equivalente Node do `fastapi-mcp` (que derivava tools automaticamente das
  rotas FastAPI), então as tools MCP são declaradas à mão, uma por rota.
- **`ml-trainer`/`data-runner` ganham um modo "consumir 1 mensagem e rodar"** —
  reaproveita `kafka-python` (ou equivalente), lê os parâmetros da mensagem em vez de
  env vars vindas de um `Workflow`. `data-runner` ganha também um modo "cadeia completa"
  (roda os 3 passos em sequência, no mesmo container) pra atender o disparo do cron.
- **Tópicos por domínio, `analysis` como discriminador em todo lugar** — KEDA
  `ScaledJob` escala pelo *volume* da fila, não filtra por conteúdo, então um tópico por
  domínio (`ml`/`data`) continua necessário. Mas **não existe tradução `analysis` →
  vocabulário interno em `ui-orchestrator`** — essa tradução só fazia sentido enquanto
  havia um `WorkflowTemplate`/namespace/entrypoint do Argo pra esconder; sem Argo
  Workflow nesta arquitetura, `workload`/`step` eram só um apelido redundante pro mesmo
  valor de `analysis`. `ui-orchestrator` só decide **em qual tópico publicar**
  (roteamento); a mensagem carrega `analysis` intacto, mesmo valor do `POST /trigger`.
  `ml-trainer`/`data-runner` traduzem `analysis → volume`/`breach`/`transform`/`quality`
  **localmente**, dentro do próprio app, pro `TRAINERS`/`STEPS` que já usam desde a
  Fase 1 — uma tabela pequena que mora perto de quem a usa, não mais atravessando uma
  fronteira de processo. Contrato completo de cada payload — `POST /trigger`,
  `trigger.ml`, `trigger.data`, `trigger.status`, `GET /runs` — em
  [`payloads.md`](./payloads.md), com JSON Schema formal em `contracts/`
  (`trigger-ml.schema.json`, `trigger-data.schema.json`, `trigger-status.schema.json`).
- **Status de um run publica 2 mensagens, não 1** — `Running` assim que o `Job` pega a
  mensagem, e o resultado final (`Succeeded`/`Failed`) ao terminar. Sem a primeira,
  `GET /runs/{run_id}` não teria como distinguir "na fila" de "processando agora".
- **`trigger.status` compactado é a fonte de verdade, o mapa em memória é um read model
  descartável** — se `ui-orchestrator` reiniciar, ele relê o tópico (pequeno: 1 registro
  por `run_id` já processado) do início antes de voltar a responder tráfego. Não é um
  banco novo — é uma propriedade nativa do Kafka (log compaction).
- **Hooks `PostSync` de health check** — `Job` por serviço, mesmo padrão do hook
  `PreSync` já usado na esteira CI (Gitea Actions → write-back de tag de imagem);
  valida conectividade com as dependências externas do serviço (Kafka sempre; ClickHouse
  pra `ml-trainer`/`data-runner`) e falha o sync do ArgoCD se algo estiver mal
  configurado.
- **Convenção de "workload nature" em aberto** — `ml-trainer`/`data-runner` deixam de
  ser `pipeline-step` puro (Fase 1 os deixou assim) e passam a ter um `ScaledJob` como
  workload próprio. Isso não é nenhuma das 4 naturezas hoje documentadas em `CLAUDE.md`
  (`deployment`/`cronjob`/`job`/`pipeline-step`) — decisão de convenção a fechar na
  implementação, não bloqueia esta revisão de spec.

---

_Gerado originalmente pelo Conductor; revisado manualmente em 2026-08-15._
