# Pipeline de Dados — Operação

Como disparar a cadeia de dados (completa ou um step isolado) e inspecionar falhas.
Detalhes de schema e nomenclatura estão em [`contracts/`](../contracts/) e
[`domain/`](../domain/) — este documento é só operação.

> Revisado em `exec-trigger_20260807`: o motor Argo Workflows saiu do stack. A cadeia
> completa é hoje um script sequencial dentro do `Job` de `data-runner`
> (`apps/data-runner/src/trigger.py`), disparado por Kafka + KEDA — nunca `argo submit`
> nem UI do Argo, que não existem mais neste projeto.

## O que a cadeia faz

`analysis: full_pipeline` no modo `consume` de `data-runner`
([`apps/data-runner/src/trigger.py`](../apps/data-runner/src/trigger.py)):

```
dbt-run  →  great-expectations  →  register-snapshot
```

- **`dbt-run`** — `dbt run --profiles-dir /dbt` (`src/steps.py::run_transform`).
  Materializa `staging → marts` sobre `incidents_received`.
- **`great-expectations`** — mesmo processo, suite `critical`
  (`src/steps.py::run_quality`, `--suite critical --upload-docs`). Falha crítica
  interrompe a cadeia antes do próximo passo — `register-snapshot` nunca roda sobre dado
  que não passou na suite.
- **`register-snapshot`** — [`apps/data-runner/src/register_snapshot.py`](../apps/data-runner/src/register_snapshot.py):
  soma `SELECT count()` de cada mart configurado, tira SHA-256 do dicionário de
  contagens e registra um MLflow run no experiment `data-pipeline-snapshots` (params
  `hash`/`dag_run_id`, tag `source`, uma métrica por mart).

A pipeline é configurada em [`infra/charts/data-runner/values.yaml`](../infra/charts/data-runner/values.yaml)
(`run.env.source`, `run.env.snapshotMarts`, `cron.enabled`/`cron.schedule`) — os mesmos
valores que antes viviam em `pipelines/data-itsm-daily/`, agora parte do próprio chart do
app, já que `data-runner` deixou de ser um passo de uma `pipelines/` genérica e passou a
ter workload (`Deployment` escalado por `ScaledObject`) próprio. Em dev e prod, um `CronJob` nativo (`ns: data`,
02:00 UTC) publica `{"run_id": "daily-<data>", "analysis": "full_pipeline"}` em
`trigger.data` — o `run_id` é determinístico pela data, então dá pra consultar
`GET /runs/daily-2026-08-16` sem procurar o id em log nenhum.

## Rerodar um step isolado (via `ui-orchestrator`)

`ui-orchestrator` (`https://orchestrator.ops-ahead.localtest.me`) é o único ponto de
entrada — REST ou MCP, sem kubeconfig nem conhecimento de Kafka/KEDA por parte de quem
chama:

```bash
# só dbt (staging → marts)
curl -X POST https://orchestrator.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{"analysis": "data_refresh"}'

# só a suite Great Expectations
curl -X POST https://orchestrator.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{"analysis": "data_quality_check"}'
```

Resposta `202 {"run_id": "..."}` na hora — o pod ainda não subiu nesse momento
(publicado em `trigger.data`; KEDA escala o `data-runner` de 0 pra 1 assim que detecta a
mensagem na fila). Consultar o resultado:

```bash
curl https://orchestrator.ops-ahead.localtest.me/runs/<run_id>
# {"run_id": "...", "status": "queued" | "Running" | "Succeeded" | "Failed", ...}
```

Nenhum dos dois dispara `register-snapshot` — esse passo só roda como parte da cadeia
completa (`analysis: full_pipeline`), já que o hash do snapshot é sobre o estado dos
marts *depois* de dbt+GE terem rodado juntos, e `full_pipeline` nunca é escolhido por um
caller (é vocabulário só do `CronJob` — ver
[`conductor/tracks/exec-trigger_20260807/payloads.md`](../conductor/tracks/exec-trigger_20260807/payloads.md)).

Contrato completo dos 4 tipos de análise aceitos (`volume_forecast`, `breach_risk`,
`data_refresh`, `data_quality_check`) em
[`apps/ui-orchestrator/README.md`](../apps/ui-orchestrator/README.md).

## Rodar a cadeia completa manualmente (raro)

Fora do horário do `CronJob`, publicar `analysis: full_pipeline` direto no tópico
`trigger.data` roda a cadeia inteira sob demanda — `ui-orchestrator` não expõe isso via
`POST /trigger` (não existe um "analysis" pra "cadeia completa" no vocabulário do
caller: o objetivo dele é a execução pontual e parametrizada de um domínio por vez, não
reimplementar o `CronJob`). Publicar manualmente, com um `run_id` à sua escolha:

```bash
kubectl exec -n data ops-ahead-kafka-0 -c kafka -- sh -c '
echo "manual-run-1:{\"run_id\":\"manual-run-1\",\"analysis\":\"full_pipeline\"}" | \
bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic trigger.data \
  --property "parse.key=true" --property "key.separator=:"
'
```

KEDA escala o `data-runner` de 0 pra 1 assim que detecta a mensagem (`pollingInterval`,
ver [`infra/charts/data-runner/values.yaml`](../infra/charts/data-runner/values.yaml)).

## Inspecionar uma falha

```bash
kubectl get jobs -n data -l app=data-runner --sort-by=.metadata.creationTimestamp
kubectl logs -n data <pod-do-job>
```

Falha em `great-expectations` (ou em `data_quality_check` isolado) — a suite `critical`
imprime `describe_dict()` da validação (JSON com cada expectation e se passou) antes de
sair com código != 0; os Data Docs completos ficam em `s3://ops-ahead-lake/ge-docs/`
(console MinIO em `https://minio.ops-ahead.localtest.me`).

Falha em `register-snapshot` — o passo só roda depois da suite `critical` passar, então
uma falha aqui é infra (ClickHouse ou MLflow inacessíveis a partir do pod), não dado
sujo.

## Ver o resultado

- **Marts:** ClickHouse, `SELECT count() FROM <mart>` — ver
  [`scripts/audit.sql`](../scripts/audit.sql) para as queries de auditoria completas
  (ingestão → marts, OLA compliance, sequências P4).
- **Snapshot:** MLflow UI, `https://mlflow.ops-ahead.localtest.me`, experiment
  `data-pipeline-snapshots` — um run por execução de `full_pipeline`, nomeado com o
  `run_id`. Só existe pra runs da cadeia completa.
- **Data Docs (GE):** console MinIO, bucket `ops-ahead-lake`, prefixo `ge-docs/`.
- **Status de um run:** `GET /runs/<run_id>` no `ui-orchestrator`, sempre — reflete o
  que o próprio `Job` publicou em `trigger.status`, nunca consulta o Kubernetes.
