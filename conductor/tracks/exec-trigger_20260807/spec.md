# Specification: Serviço de Execução Sob Demanda (Trigger Service)

**Track ID:** exec-trigger_20260807
**Type:** Feature
**Created:** 2026-08-07
**Status:** Draft

## Summary

Um **serviço interno único e centralizador** — um processo, um app, um `Deployment` — que
recebe um payload tipado e validado (Pydantic) com os parâmetros de uma execução — datas de
corte, origem/config dos dados, etc. — e dispara, por trás, um pod isolado e efêmero pra rodar
aquela análise. Substitui o fluxo manual atual (`argo submit`, `argocd app sync`,
`kubectl delete job`) e as datas/config hardcoded em `values.yaml`, sem exigir que quem
dispara a execução (dev, N1, agente de IA, futuramente outra empresa) tenha acesso direto ao
cluster ou conhecimento de Argo.

**Princípio central #1**: quem chama não sabe — nem precisa saber — que existe Argo,
Kubernetes, `Workflow`, `template`, `namespace` ou `pod` por trás. O pedido é feito em
linguagem de negócio ("quero uma previsão de volume pra esse período", "quero rodar a
checagem de qualidade dos dados"), não em linguagem de infraestrutura. Isso vale para o nome
dos campos do payload e para os valores aceitos neles — não só para a ausência de
`kubeconfig`.

**Princípio central #2**: existe **um único ponto que efetivamente fala com o cluster** — esse
mesmo serviço. REST (pra `curl`/N1/scripts) e MCP (pra agente de IA) são só duas *interfaces*
desse mesmo processo, nunca dois mecanismos paralelos ou dois deploys distintos — quem chama
via MCP não está rodando nada localmente nem falando com Argo/K8s por conta própria; a tool
MCP só encaminha pro mesmo serviço centralizador que atende o REST. Não existe cenário onde o
"start" de uma execução acontece em outro lugar que não seja esse serviço.

## Architecture

Um serviço só no meio do caminho; cada seta abaixo é uma etapa distinta do disparo de uma
análise, do pedido até o resultado.

Continua **um único serviço** (`trigger-service`, um app, um `Deployment`) — a fila Kafka
abaixo é um desacoplamento *interno* entre "receber o pedido" e "falar com o Argo/K8s", não um
segundo serviço nem um caminho que o caller acessa diretamente. O caller nunca publica em
Kafka; ele só vê REST/MCP e a resposta de status.

```
[ Caller ]  dev / N1 / agente de IA
    │
    │  1. REST  POST /trigger   ou   MCP tool call
    │     payload: { analysis, datas de corte, data_source }
    ▼
[ trigger-service — intake ]  valida o payload (Pydantic), gera `run_id`
    │
    │  2. publica o pedido validado no tópico `trigger.requests` (Kafka, já
    │     existente em ns: data) e responde 202 { run_id } na hora — não
    │     espera o Workflow ser criado
    ▼
[ trigger.requests ]  tópico Kafka
    │
    │  3. trigger-service — consumer (mesmo app/processo, grupo `trigger-service`)
    │     consome o evento
    ▼
[ trigger-service — consumer ]  resolve `analysis` → WorkflowTemplate + namespace +
    │                            parâmetros internos
    │
    │  4. cria o recurso Workflow via client Kubernetes (não fala com o
    │     argo-server por REST)
    ▼
[ Argo Workflow Controller ]  motor já instalado (infra/charts/data-workflows)
    │
    │  5. reconcilia o Workflow e agenda o Pod no namespace certo
    ▼
[ Pod isolado e efêmero ]  ml-trainer (train volume|breach)  ou  data-runner (run transform|quality)
    │
    │  6. roda a análise e grava o resultado
    ▼
[ MLflow  /  ClickHouse mart  /  GE docs ]  conforme a análise pedida

[ Caller ] ◀── 7. GET /runs/{run_id} — trigger-service procura um `Workflow`
                 chamado `trigger-{run_id}` em `ns: ml` e `ns: data` (nome
                 determinístico gerado no passo 2, sem precisar de um estado
                 auxiliar à parte); se ainda não existir, responde `queued`
                 (passo 2 aconteceu, passo 4 ainda não); se existir, devolve a
                 fase do K8s — sem kubectl, sem Argo UI, sem kubeconfig
```

## Context

Do `product.md`: a plataforma prevê volume de incidentes (D+1/D+7) e risco de breach de OLA
pra operação da Locaweb — os dois modelos de ML (`ml-volume-model`, `ml-breach-model`, da
track `ml-models_20260806`) são o coração disso.

Ao rodar a Fase 5 (validação ponta a ponta) da track `ml-models_20260806` com o cluster local
no ar pela primeira vez, dois problemas de fundo apareceram (documentados em
`docs/insights/temporal-split-data-dependency.md`):

1. **Datas de split hardcoded pra um dataset específico** — `train_end`/`validation_end`/
   `holdout_end` em `infra/apps/ml-temporal-split-values.yaml` só produzem partições
   não-vazias se o dataset completo da Locaweb (122.543 linhas, 2023-01-02 a 2025-12-31) já
   tiver sido ingerido por inteiro. Qualquer subconjunto, dataset sintético, ou range de datas
   diferente quebra o treino.
2. **Re-disparar uma execução exige comandos manuais direto no cluster** — `ml-volume-model` e
   `ml-breach-model` são `batch/v1 Job`s de nome fixo, geridos por `ArgoCD Application`s de
   sync manual. Depois que um `Job` termina, não existe "rodar de novo" reaplicando o mesmo
   manifesto — é preciso `kubectl delete job` + `argocd app sync` (ou `argo submit` direto,
   pra quem já usa `WorkflowTemplate`), o que exige kubeconfig/acesso ao cluster e conhecimento
   de Argo por parte de quem quer rodar.

O objetivo maior, que motiva tratar isso como um primitivo genérico em vez de um patch pontual
no `split.py`: o sistema hoje está inteiramente amarrado a um dataset e uma empresa (Locaweb).
A visão de produto é que esse ecossistema seja, no futuro, plugável por qualquer empresa que
queira analisar os próprios serviços/incidentes — o que exige que toda execução seja
parametrizada por payload, não hardcoded em config estática.

## User Story

- Como **dev do time**, eu quero disparar um treino/pipeline com parâmetros customizados
  (datas, origem dos dados) sem precisar de acesso direto ao cluster (kubeconfig, Argo CLI),
  para que eu possa iterar rápido sem depender de `kubectl delete job` / `argocd app sync`
  manuais.
- Como **N1/operação**, eu quero disparar uma execução sob demanda através de uma interface
  simples, para que eu não precise entender a infraestrutura por trás pra pedir um run.
- Como **agente de IA**, eu quero chamar um único ponto de entrada com os parâmetros que
  preciso, para que eu possa disparar execuções de forma autônoma, sem intervenção humana no
  cluster. Concretamente: quero isso como uma **tool call nativa (MCP)**, não como uma
  chamada HTTP genérica que eu teria que montar manualmente — o mesmo contrato de negócio
  (`analysis` + parâmetros) exposto como tool de um servidor MCP.
- Como **empresa cliente futura**, eu quero configurar meus próprios dados/parâmetros nesse
  mesmo mecanismo, para que eu consiga usar a plataforma sem depender do dataset específico da
  Locaweb.

## Acceptance Criteria

- [ ] Existe um serviço único (endpoint HTTP) que aceita uma requisição com payload tipado e
      validado (Pydantic) e dispara uma execução — sem exigir kubeconfig, acesso direto ao
      cluster, ou conhecimento de Argo por parte de quem chama.
- [ ] O contrato do payload (nome dos campos e valores aceitos) é escrito em linguagem de
      negócio — o que a pessoa quer analisar/rodar — nunca em termos de Argo/Kubernetes
      (`workflow`, `template`, `namespace`, `pod`, `job`). Quem chama não precisa saber que
      existe Argo por trás pra montar a requisição.
- [ ] O mesmo contrato (`analysis` + parâmetros) é exposto tanto como REST puro (pra
      `curl`/N1/scripts) quanto como servidor MCP (pra agente de IA chamar como tool call
      nativa, sem montar HTTP manualmente) — as duas interfaces batem no mesmo serviço, sem
      duplicar a lógica de validação/despacho.
- [ ] Todos os parâmetros de uma execução (datas de corte do split temporal, origem/config dos
      dados, etc.) vêm do payload da requisição — nada fica hardcoded em `values.yaml`/chart.
- [ ] Cada requisição dispara um pod isolado e efêmero; uma execução falhando não trava nem
      interfere em outra execução concorrente ou futura (sem precisar de `kubectl delete job`
      pra "destravar" o próximo run).
- [ ] `ml-volume-model` e `ml-breach-model` (ns `ml`) e `data-transform` e `data-quality`
      (ns `data`) passam a rodar através desse serviço, substituindo o fluxo manual atual
      (`argo submit`, `argocd app sync`, `kubectl delete job`).
- [ ] O payload aceita origem/config dos dados como parâmetro, não fixo no código — abrindo
      caminho pra apontar pra dados de outra empresa só trocando o payload, sem mudar código.
- [ ] Cada execução roda isolada por domínio/app — nunca dois workloads (ex: um `ml` e um
      `data`) dividindo o mesmo pod.
- [ ] O disparo é assíncrono ponta a ponta: `POST /trigger`/tool MCP responde imediatamente
      com um identificador de execução, sem esperar o pod terminar (nem sem esperar o
      `Workflow` sequer existir) — quem chama consulta o resultado depois, não fica bloqueado
      na chamada.

## Dependencies

- `infra/charts/data-workflows` — engine Argo Workflows já instalado no cluster (`ns: data`),
  reaproveitado como motor de execução por trás do serviço.
- Kafka (`ns: data`, já usado por `data-ingest`/`ml-burst-detector`) — novo tópico
  `trigger.requests`: desacopla receber o pedido (REST/MCP) de falar com o Argo/K8s. Nenhum
  estado auxiliar novo (Redis, banco) é necessário: o nome do `Workflow` é determinístico
  (`trigger-{run_id}`, gerado no intake), então `GET /runs/{run_id}` consulta o K8s
  diretamente — se o `Workflow` ainda não existe, o pedido está `queued`.
- Charts de `ml-volume-model`/`ml-breach-model` (`infra/charts/ml-volume-model`,
  `infra/charts/ml-breach-model`) — hoje `batch/v1 Job` de nome fixo; precisam migrar pra esse
  mecanismo.
- Charts/apps de `data-transform`/`data-quality` — hoje passos do `WorkflowTemplate`
  `data-pipeline` (`infra/charts/data-pipeline`), disparado manualmente via `argo submit`;
  precisam passar a ser disparados pelo serviço único também.
- Track `ml-models_20260806` — criou os dois treinos de ML que essa feature vai passar a
  disparar; **status: em andamento** (Fase 5, não concluída).

## Out of Scope

- Multi-tenancy de verdade (isolamento de dados/config por empresa, autenticação por cliente)
  — essa track constrói o mecanismo genérico; plugar uma segunda empresa de fato é trabalho
  futuro.
- Autenticação/autorização do serviço único (quem pode chamar o quê) — fica pra quando houver
  múltiplos consumidores reais além do time interno.
- Interface de agendamento (cron) pelo serviço — cron continua existindo à parte (`CronWorkflow`
  nativo do Argo Workflows, já esqueletado em `infra/charts/data-pipeline/templates/
  cronworkflow.yaml`), não precisa ser reimplementado dentro desta feature.

## Technical Notes

- **Uma imagem por domínio, não uma por workload nem uma única pra tudo**: consolidar
  `ml-volume-model` + `ml-breach-model` numa imagem `ml` só (parametrizada por `command`/`args`
  pra rodar `volume` ou `breach`), e `data-transform` + `data-quality` numa imagem `data` só
  (parametrizada pra rodar `transform` ou `quality`). Reduz de 4 imagens pra 2, mantendo `ml` e
  `data` isolados um do outro. Efeito colateral positivo: `ml-volume-model` e `ml-breach-model`
  já duplicam `src/split.py` byte-a-byte hoje (decisão documentada na track `ml-models_20260806`)
  — consolidar numa imagem reduz essa duplicação.
- Execução por trás do serviço único é via Argo Workflows (`WorkflowTemplate` existente pro
  padrão `data`, equivalente novo pro padrão `ml`) — não via `batch/v1 Job` cru gerido por
  ArgoCD, que é o que causa o problema #2 do contexto (nome fixo, precisa de delete manual pra
  rodar de novo).
- O payload de cada requisição precisa cobrir, no mínimo: que análise rodar, datas de corte do
  split (quando aplicável), e origem/config dos dados. Internamente essa análise mapeia pra um
  dos 4 pares `WorkflowTemplate`+parâmetros (`ml.volume`, `ml.breach`, `data.transform`,
  `data.quality`) — mas esses 4 identificadores são vocabulário interno do serviço, não do
  contrato exposto. O nome do campo e os valores aceitos no payload precisam ser escolhidos em
  linguagem de negócio (ex: "que tipo de análise" em vez de "que workload"), não copiados
  desses identificadores internos.
- **Duas transports, um serviço só**: o mesmo processo FastAPI expõe REST (pra `curl`/N1) e
  um servidor MCP (pra agente de IA) sobre o mesmo contrato/schema Pydantic — sem duplicar
  validação nem lógica de despacho para o `WorkflowTemplate`. Não existe precedente de MCP
  no repo hoje; avaliar na implementação uma lib que derive as tools MCP diretamente das
  rotas FastAPI existentes (evita manter duas definições de schema divergentes) em vez de
  escrever o server MCP à mão.

---

_Generated by Conductor. Review and edit as needed._
