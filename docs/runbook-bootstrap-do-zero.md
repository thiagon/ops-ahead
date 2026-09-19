# Runbook — subir tudo do zero e treinar os modelos

Ordem de execução para um cluster recém-criado (`make up`) até ter os quatro
modelos treinados e o serving respondendo. A regra que organiza tudo:
**nada em `ns: ml` funciona antes das marts gold existirem com histórico**, e
as marts só existem depois que os eventos atravessaram gateway → Kafka →
data-ingest → ClickHouse → dbt.

## Pré-condições que hoje bloqueiam o fluxo

Antes de qualquer envio, três coisas precisam existir e **duas delas não
existem no código hoje**:

| # | Pré-condição | Estado |
|---|--------------|--------|
| 1 | Uma origem `(tenant, source)` cadastrada em `config.origin` | **Bloqueador — ninguém publica nesse tópico** |
| 2 | O secret HMAC dessa origem no Vault, path `gateway` | Depende de (1) |
| 3 | O gateway alcançável de fora do cluster | **Bloqueador — não tem Ingress** |

### Bloqueador 1 — `config.origin` não tem produtor

`apps/ui-gateway/src/plugins/origin-registry.ts` reidrata as origens aceitas do
tópico compactado `config.origin`, e `modules/events/routes.ts` devolve
`404 UnknownOrigin` para qualquer endereço que não esteja no registry. O
registry de configuração migrou do `ui-orchestrator` para o `ui-frontend`
(commit `28cb43c`), mas o `ui-frontend` **não tem `kafkajs` no
`package.json`** — o Prisma grava em Postgres e nada republica nos tópicos
`config.*`. Ou seja: o gateway sobe com registry vazio, falha readiness, e
rejeita 100% dos POSTs.

Precisa ser resolvido antes do passo 1. Duas saídas:

- **Definitiva:** devolver ao `ui-frontend` o publisher que existia em
  `ui-orchestrator/src/modules/config/service.ts` (ver `git show f6071c5`) — cada
  escrita grava a revisão no Postgres e republica o estado no tópico compactado.
- **Desbloqueio imediato:** um job de seed que publica um registro de origem
  direto em `config.origin` e escreve o secret no Vault, só para destravar o
  bootstrap local.

### Bloqueador 2 — o gateway não é alcançável de fora

`infra/apps/ingresses.yaml` expõe vault, argocd, gitea, grafana, prometheus,
mlflow, minio e orchestrator. **Não expõe o gateway** — ele tem só Service
interno (`infra/charts/ui-gateway/templates/service.yaml`) e a NetworkPolicy
`ui-default` aceita ingress de `kube-system` (Traefik), `infra` e pods do
próprio namespace.

Como `scripts/incident_producer.py` roda na máquina do dev, ele não alcança o
Service. Opções, em ordem de preferência:

1. Rodar o producer **como Job dentro de `ns: ui`** — a NetworkPolicy já
   permite (`from: podSelector: {}`), e é o caminho que não muda a superfície
   exposta.
2. Adicionar um Ingress para o gateway em `ingresses.yaml`.

### Bloqueador 3 — o producer usa a rota antiga

`scripts/incident_producer.py:103` posta em `/webhook/v1/locaweb/{source}`. A
rota atual é `/webhook/:version/:tenant/:source`
(`apps/ui-gateway/src/modules/events/routes.ts:39`), e o envelope é montado a
partir da credencial resolvida, não da URL. O producer precisa de um
`--tenant` e montar `/webhook/v1/{tenant}/{source}`.

---

## Passo 0 — infra de pé

```bash
make up          # infra/scripts/dev-up.sh
make health      # confere nós, ArgoCD, pods, ExternalSecrets
```

Termina com tudo verde **e vazio**. Estados esperados, que não são falha:

- `ml-trainer` e `data-runner` com 0 réplicas — `minReplicaCount: 0`, sobem por lag do KEDA.
- `ml-model-serving` up mas `not ready` — `models_loader.py:33-41` não encontra
  nenhum modelo em `Production` e segura o pod em not-ready de propósito.
- Marts gold materializadas e vazias — o PreSync `data-runner-build` roda
  `dbt run` contra bronze vazio, que é seguro por desenho (`src/steps.py:11-17`).

## Passo 1 — cadastrar a origem

Resolver o bloqueador 1. Ao final, `config.origin` precisa ter um registro com
`tenant_id`, `source`, `intake: "alert"`, `envelope_version: "v1"`,
`enabled: true`, e o secret correspondente no Vault (path `gateway`, key
`HMAC_SECRET_LOCAWEB_ITSM`).

**Verificação:** o pod do `ui-gateway` passa a `ready` (readiness depende do
registry não estar vazio).

## Passo 2 — enviar os eventos históricos

Com a origem cadastrada, rodar o producer como Job em `ns: ui`:

```bash
uv run python scripts/incident_producer.py \
  --gateway-url http://gateway.ui.svc.cluster.local:3000 \
  --tenant <tenant_id> --source itsm
```

São **122.543 linhas cobrindo 2023-01-02 a 2025-12-31** (644 dias distintos).
Usar `--speed 0` (o default) no bootstrap: o objetivo é ter histórico, não
simular tempo real.

**Por que o histórico inteiro importa:** `incident_producer.py:67-70` envia
`resolved_at`/`closed_at` no envelope justamente para que silver não infira o
instante de fechamento a partir da hora do replay — sem isso toda duração
histórica vira a idade do replay, e o modelo de breach treina em lixo.

**Verificação:** `count(*)` nas tabelas bronze do ClickHouse bate com o total
enviado.

## Passo 3 — materializar as marts

```
POST /analyses  { "analysis": "data_refresh" }
```

No `gateway.ops-ahead.localtest.me`. Isso publica em `trigger.data`, o
KEDA escala o `data-runner`, e ele roda `dbt run` + snapshot no Redis
(`src/steps.py:20-26`).

Depois, a checagem de qualidade:

```
POST /analyses  { "analysis": "data_quality_check" }
```

**Verificação obrigatória antes de seguir** — é o portão que separa "sem dado"
de "erro de modelo":

```sql
SELECT min(date), max(date), count(*) FROM gold_alert_daily_features;
SELECT count(*) FROM breach_training_examples;
SELECT count(*) FROM gold_monitor_daily_features;
```

Se `gold_alert_daily_features` vier vazia, **pare aqui** — todo o passo 4 vai
falhar e o erro vai apontar para o lugar errado.

`gold_monitor_daily_features` vem de `events.raw.monitor`, que o producer de
incidentes **não** alimenta (ele só posta alerts). O passo 4.3
(`external_event_detection`) só roda se houver uma fonte de monitor; sem ela,
pule-o e registre como pendência.

## Passo 4 — treinar, um a um

Um `POST /analyses` por vez, aguardando `GET /analyses/{id}` chegar a
`succeeded` antes do próximo. O `ml-trainer` processa uma mensagem por vez e o
KEDA escala por lag — disparar tudo junto só empilha réplicas competindo pelo
mesmo ClickHouse.

### Os boundaries do split

`volume_forecast` e `breach_risk` exigem `train_end`/`validation_end`/
`holdout_end`, sem default por desenho (`settings.py:21-25`). Sobre o range
real do dataset (2023-01-02 → 2025-12-31), um corte 70/15/15:

| Boundary | Data |
|----------|------|
| `train_end` | `2025-05-31` |
| `validation_end` | `2025-09-30` |
| `holdout_end` | `2025-12-31` |

As três partições precisam sair não-vazias ou `split.py:56-76` levanta
`ValueError` — que é o erro que você vinha vendo num cluster sem dado.

### 4.1 — volume_forecast

```json
{ "analysis": "volume_forecast",
  "train_end": "2025-05-31",
  "validation_end": "2025-09-30",
  "holdout_end": "2025-12-31" }
```

Treina Prophet por `priority_group` + LightGBM, para D+1 e D+7, e grava o
forecast em `gold_volume_forecast`. Com `auto_promote` (default `true`),
registra e promove a `Production`.

**Verificação:** run visível no experimento `volume-forecast` do MLflow, e
`SELECT count(*) FROM gold_volume_forecast` maior que zero.

### 4.2 — breach_risk

```json
{ "analysis": "breach_risk",
  "train_end": "2025-05-31",
  "validation_end": "2025-09-30",
  "holdout_end": "2025-12-31" }
```

Mesmos boundaries — os dois modelos precisam do mesmo recorte temporal para
que as métricas sejam comparáveis.

### 4.3 — external_event_detection (condicional)

```json
{ "analysis": "external_event_detection" }
```

Só se `gold_monitor_daily_features` tiver linhas. Não usa boundaries —
Isolation Forest treina não-supervisionado sobre todo o histórico.

### 4.4 — kpi_projection

```json
{ "analysis": "kpi_projection" }
```

Por último: `main.py:47-56` lê `gold_alert_daily_features` **e**
`kpi_monthly_state`, `gold_alert_kpi_achievement` e os targets de KPI. Depende
do passo 3 ter rodado, não dos modelos anteriores.

## Passo 5 — serving enxergar os modelos

`models_loader.py` carrega os modelos **uma vez, no startup**. O deployment tem
o annotation `ops-ahead.io/restarted-at` exatamente para isso
(`infra/charts/ml-model-serving/templates/deployment.yaml:23-26`): mudar o
valor em `values-dev.yaml`, commitar, e o ArgoCD força o rollout.

**Verificação:** o pod passa a `ready` e `/predict/volume` deixa de devolver
`503 ModelNotLoaded`.

## Passo 6 — drift (opcional, e só depois)

`drift_monitoring` compara a distribuição atual contra a de referência. Rodar
logo após o treino não diz nada — só faz sentido depois que houver dado novo
além do que treinou.

---

## Resumo da ordem

```
make up
  └─ (bloqueador) publisher de config.origin
       └─ cadastrar origem + secret no Vault      → gateway fica ready
            └─ producer 122k eventos (Job em ns:ui) → bronze populado
                 └─ data_refresh → data_quality_check → marts gold
                      └─ volume_forecast
                      └─ breach_risk
                      └─ external_event_detection  (se houver monitor)
                      └─ kpi_projection
                           └─ restart do ml-model-serving → ready
```

## Dívidas que este runbook expõe

1. **`config.origin` sem produtor** — bloqueia todo o bootstrap.
2. **Gateway sem Ingress** — o producer local não o alcança.
3. **`incident_producer.py` na rota antiga** — falta `--tenant`.
4. **Boundaries manuais** — deveriam ser derivados do range real de
   `gold_alert_daily_features` quando omitidos, em vez de exigir que o operador
   saiba as datas.
5. **"Sem dado" indistinguível de "erro"** — `ValueError` de partição vazia vira
   `status: Failed` genérico em `trigger.status`; deveria ser um estado próprio,
   checado antes de carregar Prophet/LightGBM.
6. **Nenhuma fonte de `events.raw.monitor`** — `external_event_detection` e as
   marts `gold_monitor_*` ficam ociosas.
