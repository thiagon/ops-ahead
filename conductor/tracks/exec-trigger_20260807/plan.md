# Implementation Plan: Serviço de Execução Sob Demanda (Trigger Service)

**Track ID:** exec-trigger_20260807
**Spec:** [spec.md](./spec.md)
**Created:** 2026-08-14
**Status:** [ ] Not Started

## Overview

Seis fases: primeiro elimina a duplicação de imagem (pré-requisito técnico das notas do
spec), depois constrói o serviço em si, depois o mecanismo de execução por trás dele
(WorkflowTemplates parametrizados + RBAC), depois o deploy do serviço, depois a migração/corte
do fluxo manual antigo, e por fim a validação ponta a ponta — que é também o que destrava a
Task 5.1 da track `ml-models_20260806` (rodar os treinos sobre o dataset completo), hoje
pendente exatamente pela falta deste mecanismo.

Maior que o track "ideal" (2-4 fases) porque toca 6 apps/charts existentes além de criar 3
novos — justificado pelo escopo real: não dá para separar "consolidar imagens" de "construir o
serviço que as dispara" em tracks independentes sem deixar uma delas com metade do valor.

### Decisões de arquitetura (não estão no spec.md, resolvidas aqui)

- **Execução via cliente Kubernetes, não via API REST do `argo-server`.** O consumer do
  `trigger-service` (task 2.9) cria o recurso `Workflow` (CR `argoproj.io`) diretamente via
  `kubernetes` client Python, autenticado com sua própria `ServiceAccount` + RBAC. Evita
  depender do modo de auth do `argo-server` (`authModes: [server]` em prod = bearer token
  a gerenciar como segredo extra) — o `workflow-controller` reconcilia o `Workflow` do
  mesmo jeito não importa quem o criou.
- **Intake (REST/MCP) desacoplado da criação do `Workflow` via Kafka.** `POST /trigger`/tool
  MCP só valida o payload e publica em `trigger.requests`; quem fala com o K8s é um consumer
  desse tópico, no mesmo processo. Evita a rota HTTP ficar bloqueada numa chamada ao K8s
  (timeout de API, throttling), reaproveita o Kafka que a plataforma já usa pra tudo mais
  (`data-ingest`, `ml-burst-detector`), e o nome determinístico do `Workflow`
  (`trigger-{run_id}`) elimina a necessidade de um estado auxiliar (Redis/banco) só pra
  responder `GET /runs/{run_id}` antes do `Workflow` existir.
- **Um `WorkflowTemplate` por domínio, não um genérico.** `ml-workflow-template` (`ns: ml`)
  e uma extensão do `data-pipeline` existente (`ns: data`) com um segundo entrypoint de
  step único — mantém `ml` e `data` isolados (RBAC e imagem não se cruzam) e preserva o
  entrypoint de cadeia completa que o `CronWorkflow` de `data-pipeline` já usa.
- **`trigger-service` roda em `ns: data`**, co-locado com o motor Argo (`data-workflows`,
  já instalado nesse namespace) e a `ServiceAccount argo-workflow-executor` existente. Ganha
  uma `Role`/`RoleBinding` adicional em `ns: ml` para poder criar `Workflow`s lá também —
  em vez de introduzir `ns: infra` (reservado a componentes privilegiados de cluster) para
  um serviço de aplicação.
- **Payload Pydantic fica local ao `trigger-service`**, seguindo o precedente de
  `ml-model-serving/src/schemas.py` — `contracts/` hoje só guarda JSON Schema
  cross-linguagem (Node↔Python) para o evento Kafka; não há outro consumidor do payload
  HTTP além do próprio serviço.
- **O contrato exposto não usa vocabulário de Argo/K8s** (princípio agora explícito em
  `spec.md`). O campo discriminador do payload se chama `analysis` (não `workload` — esse é
  jargão de K8s, inclusive usado nesse sentido na tabela "Workload natures" do `CLAUDE.md`
  raiz), com valores em linguagem de negócio: `volume_forecast`, `breach_risk`,
  `data_refresh`, `data_quality_check`. O mapeamento `analysis` → `WorkflowTemplate` +
  `namespace` + `arguments.parameters` (os identificadores internos `ml.volume`/`ml.breach`/
  `data.transform`/`data.quality`) é resolvido dentro do serviço, nunca aparece no contrato
  HTTP nem na resposta.
- **Nomes dos apps consolidados**: `apps/ml-trainer` (substitui `ml-volume-model` +
  `ml-breach-model`) e `apps/data-runner` (substitui `data-transform` + `data-quality`),
  cada um despachando por `command`/`args` (`train volume|breach`, `run transform|quality`).
- **Resposta assíncrona**: `POST /trigger` retorna `202` com o nome do `Workflow` criado;
  `GET /runs/{name}` consulta a fase atual — sem isso, quem chama ainda precisaria de
  `kubectl`/Argo UI pra saber se o run terminou, o que violaria o próprio critério de
  aceite ("sem exigir... conhecimento de Argo").

---

## Phase 1: Consolidação de imagens (`ml-trainer`, `data-runner`)

Pré-requisito técnico: o serviço só faz sentido despachando 2 imagens (uma por domínio), não
4. Resolve de quebra a duplicação de `split.py` já documentada na track `ml-models_20260806`.

### Tasks

- [x] 1.1: `apps/ml-trainer/` — novo app Python consolidando `apps/ml-volume-model` +
      `apps/ml-breach-model`; `src/split.py` único (elimina a duplicação byte-a-byte);
      dispatch via `sys.argv`/subcomando (`train volume` / `train breach`); `Settings`
      mantém os mesmos nomes de env var das duas apps atuais (`TRAIN_END`,
      `VALIDATION_END`, `HOLDOUT_END`, `CLICKHOUSE_URL`, `MLFLOW_TRACKING_URI`, etc.), sem
      default hardcoded para as datas de corte — passam a ser obrigatórias via payload
- [x] 1.2: `apps/data-runner/` — novo app consolidando `apps/data-transform` (dbt) +
      `apps/data-quality` (Great Expectations); dispatch via subcomando (`run transform`
      roda `dbt run --profiles-dir /dbt`, `run quality` roda o `runner.py` existente com
      `--suite`); projeto dbt de `data-transform` migra para dentro deste app
- [x] 1.3: `Dockerfile` dos dois novos apps seguindo o padrão uv multi-stage já usado nos
      outros 4 (`uv sync --frozen --no-install-workspace` → `COPY .` → `uv sync --locked
      --package <pkg>`)
- [x] 1.4: Remover `apps/ml-volume-model/`, `apps/ml-breach-model/`, `apps/data-transform/`,
      `apps/data-quality/` (código já migrado nas tasks 1.1/1.2)
- [x] 1.5: Migrar testes unitários existentes das 4 apps antigas para os 2 novos apps (split
      temporal, filtro de elegibilidade KPI, feature engineering, suíte GE, dbt tests)

### Verification

- [x] `uv run --package ops-ahead-ml-trainer pytest` e `uv run --package ops-ahead-data-runner
      pytest` passam — via `pytest apps/<app>` explícito; o comando sem path já falhava
      *antes* desta track (colisão do módulo `tests` entre apps quando coletado a partir da
      raiz do repo — achado registrado, não é regressão desta track)
- [x] `docker build -f apps/ml-trainer/Dockerfile .` e `docker build -f
      apps/data-runner/Dockerfile .` completam sem erro (exigiu criar `.dockerignore` na
      raiz — inexistente antes, quebrava qualquer build local com `.data/` populado)
- [x] `apps/ml-volume-model`, `apps/ml-breach-model`, `apps/data-transform`,
      `apps/data-quality` não existem mais no working tree

---

## Phase 2: `trigger-service` — payload, intake e consumer

Um app só, duas metades testáveis em isolamento: o intake (REST/MCP → Kafka, testável com
um producer fake) e o consumer (Kafka → Workflow, testável com um client Kubernetes
fake/mock) — ver diagrama de `spec.md`.

### Tasks

- [x] 2.1: `apps/trigger-service/` — novo app FastAPI (`workload: deployment`, `ns: data`),
      seguindo o app-factory/lifespan de `apps/ml-model-serving/src/main.py` como referência;
      roda o servidor HTTP e o consumer Kafka (task 2.9) no mesmo processo (background task
      no lifespan), não como dois deploys
- [x] 2.2: Modelo Pydantic `TriggerRequest` — discriminado por `analysis`
      (`volume_forecast` | `breach_risk` | `data_refresh` | `data_quality_check`, em
      linguagem de negócio, sem termos de Argo/K8s no contrato — ver "Decisões de
      arquitetura"); campos comuns (`data_source`/`clickhouse_url` como override opcional,
      seguindo a convenção de URL única) e campos específicos de `volume_forecast`/
      `breach_risk` (`train_end`/`validation_end`/`holdout_end`, sem default — falha a
      validação se vierem sem datas)
- [x] 2.3: `POST /trigger` (intake) — valida o payload, gera `run_id` (UUID), publica no
      tópico Kafka `trigger.requests` (evento = `TriggerRequest` + `run_id`), responde `202`
      com `{run_id}` na hora — não cria o `Workflow` inline, não espera o consumer
- [x] 2.4: `GET /runs/{run_id}` — tenta buscar `Workflow` chamado `trigger-{run_id}` em
      `ns: ml` e `ns: data`; `404` do K8s nas duas ⇒ responde `queued`; achou ⇒ devolve a fase
      (`Pending`/`Running`/`Succeeded`/`Failed`) — sem estado auxiliar (Redis/banco) próprio
- [x] 2.5: `GET /health`
- [x] 2.6: Testes unitários do intake (`TestClient` do FastAPI + producer Kafka fake
      injetado) cobrindo: payload válido por `analysis`, payload inválido (ex:
      `volume_forecast` sem datas), `run_id` sempre gerado e devolvido em `202`
- [x] 2.7: Servidor MCP montado sobre o mesmo app FastAPI (mesma porta/processo) — avaliar
      lib que derive as tools MCP direto das rotas `/trigger`/`/runs` (ex: `fastapi-mcp`) em
      vez de reimplementar o schema à mão; a tool MCP resultante usa o mesmo `TriggerRequest`
      (`analysis` + parâmetros) da task 2.2, publica no mesmo tópico Kafka do intake — nunca
      fala com Argo/K8s diretamente
- [x] 2.8: Teste de integração do servidor MCP: cliente MCP (ex: `mcp` SDK em modo teste, ou
      chamada HTTP direta ao transport escolhido) invoca a tool de disparo e recebe o mesmo
      `{run_id}` que `POST /trigger` retornaria pro mesmo payload
- [x] 2.9: Consumer Kafka (grupo `trigger-service`, tópico `trigger.requests`) — resolve
      `analysis` → `WorkflowTemplate` + `namespace` + `arguments.parameters` internos (mapa
      `analysis` → `ml.volume`/`ml.breach`/`data.transform`/`data.quality`, nunca exposto),
      cria o `Workflow` (nome `trigger-{run_id}`) via client Kubernetes
- [x] 2.10: Testes unitários do consumer (client Kubernetes fake injetado) cobrindo:
      mapeamento `analysis`→template/namespace, nome determinístico do `Workflow`, e
      tratamento de evento malformado (não deve derrubar o consumer nem travar o tópico —
      publica em dead-letter ou loga e segue, decidir na implementação)

### Verification

- [x] `uv run --package ops-ahead-trigger-service pytest` passa (via `pytest apps/trigger-service`
      — mesma ressalva de path da Fase 1)
- [x] `POST /trigger` com payload malformado retorna `422`, nunca `500`
- [x] A tool MCP e o endpoint REST aceitam o mesmo payload, publicam no mesmo tópico Kafka e
      produzem o mesmo `run_id`/resultado (nenhuma lógica de validação/despacho duplicada
      entre as duas transports, e nenhuma delas cria o `Workflow` diretamente — só o consumer
      da task 2.9 faz isso)

---

## Phase 3: WorkflowTemplates parametrizados + RBAC + Kafka

O mecanismo de execução de verdade — hoje nenhum `WorkflowTemplate` do repo aceita
parâmetro vindo de fora do `values.yaml` renderizado pelo Helm, e não existe tópico Kafka
pra pedidos de execução.

### Tasks

- [x] 3.1: `infra/charts/ml-workflow-template/` (novo, `ns: ml`) — `WorkflowTemplate` com
      um entrypoint parametrizado (`workload`: `volume`|`breach`, mais as datas de corte e
      `clickhouse_url`) que roda a imagem `ml-trainer` com `command`/`args` resolvidos a
      partir do parâmetro; `serviceAccountName` análogo a `argo-workflow-executor`, criado
      em `ns: ml` (não existe RBAC de executor lá hoje). Também criado
      `infra/apps/ml-workflow-template.yaml` (Application, automated) — sem ele o chart
      nunca sincroniza; e `apps/ml-trainer/chart/app.yaml` + `values-dev.yaml` (deferidos da
      Fase 1, necessários pro CI write-back ter onde escrever a tag)
- [x] 3.2: Estendido `infra/charts/data-pipeline/templates/workflowtemplate.yaml` com um
      segundo entrypoint de step único (`step`: `transform`|`quality`) usando a imagem
      `data-runner` consolidada — preserva o entrypoint de cadeia completa
      (`dbt-run → great-expectations → register-snapshot`) que o `CronWorkflow` existente
      (`templates/cronworkflow.yaml`) continua referenciando sem mudança. Também trocado
      `data-transform`/`data-quality` → `data-runner` nas imagens do `dbt-run`/
      `great-expectations` (Fase 1 já tinha removido as imagens antigas — sem isso o
      pipeline diário já estaria quebrado) e `pipelines/data-itsm-daily/appset.yaml`
      (`extraValueFiles` apontava pros dois apps removidos); criado
      `apps/data-runner/chart/app.yaml` + `values-dev.yaml` (mesmo motivo do ml-trainer acima)
- [x] 3.3: Tópico Kafka `trigger.requests` em `infra/charts/data-kafka/values.yaml` **e**
      `values-dev.yaml` (a segunda lista sobrescreve a primeira por completo — Helm não
      faz merge de listas; sem editar as duas o tópico nunca existiria em dev). Sem
      `ExternalSecret`/credencial nova: Kafka neste cluster não tem auth (nenhum app
      existente injeta senha de Kafka — conferido em `data-ingest`/`ml-burst-detector`),
      então não há segredo real pra buscar
- [x] 3.4: RBAC do `trigger-service`: `ServiceAccount` + `Role`/`RoleBinding` em `ns: data`
      (criar/ler `workflows.argoproj.io`) e um `Role`/`RoleBinding` equivalente em `ns: ml`
      (cross-namespace) — escopo mínimo: `create`/`get`/`list`/`watch` em
      `workflows.argoproj.io`, `get`/`watch` em `workflowtaskresults`. Vive em
      `infra/charts/trigger-service/templates/rbac.yaml`, mesmo chart que a Fase 4
      completa com Deployment/Service/HPA — ainda sem `infra/apps/trigger-service.yaml`
      (Fase 4), então nada disso está sincronizado no cluster ainda
- [x] 3.5: Nenhum manifesto novo — `infra/apps/namespaces.yaml` já libera ingress em
      `ns: data` pra mesmo-namespace + `infra` (e mais: `ml`, `ui:9092`) via a
      `allow-ingress` default do namespace, e egress já é livre por estratégia do cluster
      ("Egress não é restrito... não agrega valor em dev local") — checado antes de criar
      qualquer coisa redundante

### Verification

- [x] `helm template infra/charts/ml-workflow-template`, `helm template
      infra/charts/data-pipeline` (com os values reais da pipeline + `data-runner`) e
      `helm template infra/charts/data-kafka` (com `values-dev.yaml`, onde o tópico
      precisou ser adicionado separadamente) renderizam sem erro
- [ ] `kubectl auth can-i create workflows.argoproj.io --as=system:serviceaccount:data:trigger-service -n ml`
      retorna `yes` — **adiado pra Fase 6**: exige `infra/apps/trigger-service.yaml`
      (Fase 4) sincronizado no cluster; o RBAC em si já está commitado, só falta o
      Application que o aplica

---

## Phase 4: Deploy do `trigger-service`

### Tasks

- [x] 4.1: `infra/charts/trigger-service/` (`Deployment` + `Service` + `HPA` + probes),
      copiando o padrão de `infra/charts/ml-model-serving/`. `serviceAccountName` no pod
      spec aponta pro `ServiceAccount` da Fase 3 (RBAC sem pod nenhum não vale nada)
- [x] 4.2: `apps/trigger-service/chart/app.yaml` (`workload: deployment`, `namespace: data`,
      `chart: infra/charts/trigger-service`) + `values-dev.yaml`
- [x] 4.3: `infra/apps/trigger-service.yaml` (`ArgoCD Application`, `syncPolicy.automated`,
      sync-wave `8` — depois de `data-workflows` (5) e `data-kafka` (6, o broker que o
      lifespan do app conecta no startup))
- [x] 4.4: `infra/apps/ingresses.yaml` — host `trigger.ops-ahead.localtest.me` (dev), mesmo
      padrão dos outros hosts `*.ops-ahead.localtest.me`; mesmo `Ingress`/`Service` expõe o
      path REST e o path do transport MCP (mesmo processo/porta da task 2.7, sem `Service`
      nem host separado) — aponta pro Service `trigger-service-trigger-service` (confirmado
      contra o padrão real dos outros apps `deployment` no cluster: `<app>-<app>`)
- [x] 4.5: Atualizado a matrix estática do CI (`.gitea/workflows/build.yaml` linha do
      `strategy.matrix.app`) — removidos os 4 apps antigos, adicionados `ml-trainer`,
      `data-runner`, `trigger-service`

### Verification

- [x] `helm template infra/charts/trigger-service` renderiza sem erro
- [ ] Push dispara o CI e os 3 novos apps buildam/publicam imagem — **adiado**: ainda não
      fiz push da branch pro Gitea local nem pro GitHub; verificar via `gh run list` depois
      do push (Fase 6, junto da validação ponta a ponta)

---

## Phase 5: Migração e corte do fluxo manual antigo

### Tasks

- [ ] 5.1: Remover `infra/charts/ml-volume-model/`, `infra/charts/ml-breach-model/`,
      `infra/apps/ml-volume-model.yaml`, `infra/apps/ml-breach-model.yaml` (substituídos
      pelo `WorkflowTemplate` da Fase 3, disparado pelo `trigger-service`)
- [ ] 5.2: Remover `infra/apps/ml-temporal-split-values.yaml` — as datas de corte deixam de
      ter fonte fixa em `values.yaml`; passam a vir sempre do payload de cada requisição
- [ ] 5.3: Atualizar `docs/data-pipeline.md` (e qualquer outro doc que cite
      `argo submit --from workflowtemplate/data-pipeline`, `kubectl delete job` ou
      `argocd app sync ml-volume-model`/`ml-breach-model` como fluxo operacional) para o
      novo `curl` contra `trigger-service`
- [ ] 5.4: Documentar o payload aceito pelos 4 `workload`s (exemplo de request por tipo) —
      `docs/context/` ou README do próprio `apps/trigger-service/`

### Verification

- [ ] `grep -r` por `argo submit --from workflowtemplate`, `kubectl delete job` e
      `argocd app sync ml-` fora de `git log`/`docs/insights/` (achados históricos) não
      retorna nada em docs operacionais correntes

---

## Phase 6: Validação ponta a ponta

Fecha os critérios de aceite do `spec.md` e destrava a Task 5.1 da track
`ml-models_20260806` (rodar os treinos sobre o dataset completo — hoje pendente
justamente pela falta deste mecanismo).

### Tasks

- [ ] 6.1: Disparar os 4 `workload`s via `trigger-service` no cluster local
      (`data.transform`, `data.quality`, `ml.volume`, `ml.breach`) e confirmar que cada
      `Workflow` completa sem erro
- [ ] 6.2: Confirmar isolamento: duas requisições concorrentes (ex: `ml.volume` +
      `data.transform` ao mesmo tempo) rodam em pods separados sem interferência; matar um
      `Workflow` propositalmente e confirmar que o próximo run do mesmo `workload` dispara
      normalmente sem `kubectl delete job` manual
- [ ] 6.3: Rodar `ml.volume` e `ml.breach` via `trigger-service` sobre o dataset completo
      ingerido (122.543 linhas) — é a Task 5.1 pendente de `ml-models_20260806`; se
      completar aqui, marcar essa task como feita no `plan.md` daquela track com referência
      cruzada para esta
- [ ] 6.4: Corrigir a tabela "Workload natures" do `CLAUDE.md` raiz (hoje lista `worker`,
      mas o código real usa `deployment`; hoje cita `values-image.yaml`, mas o write-back do
      CI escreve em `values-dev.yaml`) — divergência encontrada durante a exploração desta
      track, sem relação direta com o trigger service mas tocada porque `app.yaml` está sob
      revisão de qualquer forma
- [ ] 6.5: Commitar `docs/insights/temporal-split-data-dependency.md` (hoje existe só no
      working dir, não versionado) como registro do achado que originou esta track

### Verification

- [ ] Todos os critérios de aceite de `spec.md` verificados como verdadeiros no cluster
      local (não só "implementado")
- [ ] Nenhum fluxo restante exige `kubectl delete job`, `argo submit` manual ou
      `argocd app sync` para re-disparar `ml.volume`, `ml.breach`, `data.transform` ou
      `data.quality`

---

## Checkpoints

| Phase   | Checkpoint SHA | Date | Status  |
| ------- | -------------- | ---- | ------- |
| Phase 1 |                |      | pending |
| Phase 2 |                |      | pending |
| Phase 3 |                |      | pending |
| Phase 4 |                |      | pending |
| Phase 5 |                |      | pending |
| Phase 6 |                |      | pending |
