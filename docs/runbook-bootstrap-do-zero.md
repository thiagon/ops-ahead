# Runbook — subir tudo do zero e treinar os modelos

Ordem de execução para um cluster recém-criado (`make up`) até ter os quatro
modelos treinados e o serving respondendo. A regra que organiza tudo:
**nada em `ns: ml` funciona antes das marts gold existirem com histórico**, e
as marts só existem depois que os eventos atravessaram gateway → Kafka →
data-ingest → ClickHouse → dbt.

## Pré-condições que hoje bloqueiam o fluxo

Antes de qualquer envio, duas coisas precisam existir:

| # | Pré-condição | Estado |
|---|--------------|--------|
| 1 | A origem em `ORIGINS`, no Vault, path `gateway` | Semeada por `make up` a partir do `.env` |
| 2 | O gateway alcançável de fora do cluster | **Bloqueador — não tem Ingress** |

`ORIGINS` é um JSON de `"tenant:source"` para `{intake, secret}` — estar nele é
o que torna uma origem real, e um webhook contra qualquer outro endereço leva
404. Adicionar origem é editar esse JSON por enquanto, sem passar pelo
barramento.

Traduzir é outra coisa: quem decide se um evento vira linha bronze é o
`data-ingest`, contra as regras em `rules.mapping`. Um evento de origem aceita
mas sem mapeamento entra no lake cru em vez de virar bronze.

### Bloqueador — o gateway não é alcançável de fora

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

## Passo 1 — publicar as regras da origem

```bash
uv run python scripts/seed_config.py --gateway-url http://localhost:8080
```

Publica o mapeamento do `service_now` (bindings + dicionário, um record só),
os prazos e as metas de KPI. Sem isso o gateway aceita os eventos do mesmo
jeito — a origem está em `ORIGINS` —, mas o `data-ingest` não consegue
traduzi-los e eles ficam só no lake.

**Verificação:** `rules.mapping` tem um registro sob a chave
`<tenant>:<source>`, e o `data-ingest` loga a aplicação dele.

## Passo 2 — enviar os eventos históricos

Rodar o producer como Job em `ns: ui`:

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
  └─ seed_config.py → regras em rules.mapping/deadline/target
       └─ producer 122k eventos (Job em ns:ui)     → bronze populado
            └─ data_refresh → data_quality_check → marts gold
                      └─ volume_forecast
                      └─ breach_risk
                      └─ external_event_detection  (se houver monitor)
                      └─ kpi_projection
                           └─ restart do ml-model-serving → ready
```

## Dívidas que este runbook expõe

1. **Gateway sem Ingress** — o producer local não o alcança.
2. **Boundaries manuais** — deveriam ser derivados do range real de
   `gold_alert_daily_features` quando omitidos, em vez de exigir que o operador
   saiba as datas.
3. **"Sem dado" indistinguível de "erro"** — `ValueError` de partição vazia vira
   `status: Failed` genérico em `trigger.status`; deveria ser um estado próprio,
   checado antes de carregar Prophet/LightGBM.
4. **Nenhuma fonte de `events.raw.monitor`** — `external_event_detection` e as
   marts `gold_monitor_*` ficam ociosas.
