# Pipeline de Dados — Operação

Como disparar a DAG `data-pipeline` (cadeia completa ou um step isolado) e inspecionar
falhas. Detalhes de schema e nomenclatura estão em [`contracts/`](../contracts/) e
[`domain/`](../domain/) — este documento é só operação.

## O que a DAG faz

`WorkflowTemplate` chamada `data-pipeline`, definida em
[`infra/charts/data-pipeline/templates/workflowtemplate.yaml`](../infra/charts/data-pipeline/templates/workflowtemplate.yaml),
rodando no `ns: data`:

```
dbt-run  →  great-expectations  →  register-snapshot
```

- **`dbt-run`** — `dbt run --profiles-dir /dbt` na imagem `data-runner` (`run transform`).
  Materializa `staging → marts` sobre `incidents_received`.
- **`great-expectations`** — mesma imagem `data-runner` (`run quality`), roda a suite
  `critical` (`--suite critical --upload-docs`). Falha crítica interrompe a DAG antes do
  próximo step — `register-snapshot` nunca roda sobre dado que não passou na suite.
- **`register-snapshot`** — script Python inline: soma `SELECT count()` dos 6 marts, tira SHA-256 do dicionário de contagens e registra um MLflow run no experiment `data-pipeline-snapshots` (params `hash`/`dag_run_id`, tag `source`, uma métrica por mart).

A pipeline é configurada em [`pipelines/data-itsm-daily/`](../pipelines/data-itsm-daily/)
(`values.yaml` — source, marts do snapshot, cron; `appset.yaml` — chart base + overlays de
imagem). Em dev, `cron.enabled: false`. Em prod, `CronWorkflow` `data-pipeline-daily`
dispara a cadeia completa às 02:00 UTC.

## Rerodar um step isolado (via `trigger-service`)

Até a track `exec-trigger_20260807`, Argo Workflows não permitia reiniciar um único step de
um `Workflow` já finalizado — só rodar a cadeia inteira de novo. O
`trigger-service` (`https://trigger.ops-ahead.localtest.me`) cobre exatamente esse caso via
um segundo entrypoint (`single-step`) do mesmo `WorkflowTemplate`, sem exigir kubeconfig,
`argo` CLI nem conhecimento de Argo:

```bash
# só dbt (staging → marts)
curl -X POST https://trigger.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{"analysis": "data_refresh"}'

# só a suite Great Expectations
curl -X POST https://trigger.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{"analysis": "data_quality_check"}'
```

Resposta `202 {"run_id": "..."}` na hora — o `Workflow` ainda não existe nesse momento
(publicado em Kafka, criado pelo consumer logo em seguida). Consultar o resultado:

```bash
curl https://trigger.ops-ahead.localtest.me/runs/<run_id>
# {"run_id": "...", "status": "queued" | "Pending" | "Running" | "Succeeded" | "Failed"}
```

Nenhum dos dois dispara `register-snapshot` — esse step só roda como parte da cadeia
completa (abaixo), já que o hash do snapshot é sobre o estado dos 6 marts *depois* de
dbt+GE terem rodado juntos.

Ver payload completo dos 4 tipos de análise aceitos (`volume_forecast`, `breach_risk`,
`data_refresh`, `data_quality_check`) em [`apps/trigger-service/README.md`](../apps/trigger-service/README.md).

## Rodar a cadeia completa manualmente (raro)

Fora do cron, a cadeia inteira (`dbt-run → great-expectations → register-snapshot`) ainda se
dispara do jeito de sempre — `trigger-service` não cobre esse caso (não existe um "analysis"
pra "cadeia completa": o objetivo dele é a execução pontual e parametrizada de um domínio por
vez, não reimplementar o `CronWorkflow`).

**Via Argo Workflows UI** — `https://argo-workflows.ops-ahead.localtest.me`, aba Workflow
Templates → `data-pipeline` → Submit.

**Via CLI** (precisa do `argo` CLI e contexto apontando pro cluster local):

```bash
argo submit --from workflowtemplate/data-pipeline -n data --watch
```

`--watch` acompanha os steps em tempo real; sem ele, `argo list -n data` mostra o run e
`argo get <workflow-name> -n data` traz o status pontual.

## Inspecionar uma falha

```bash
argo list -n data                              # runs recentes e status
argo get <workflow-name> -n data                # detalhe dos steps, qual falhou
argo logs <workflow-name> -n data -c <step>      # logs do container do step (dbt-run | great-expectations | register-snapshot | single-step)
```

Falha em `great-expectations` (ou em `single-step` com `data_quality_check`) — a suite
`critical` imprime `describe_dict()` da validação (JSON com cada expectation e se passou)
antes de sair com código != 0; os Data Docs completos ficam em
`s3://ops-ahead-lake/ge-docs/` (console MinIO em `https://minio.ops-ahead.localtest.me`).

Falha em `register-snapshot` — o step só roda depois da suite `critical` passar, então uma
falha aqui é infra (ClickHouse ou MLflow inacessíveis a partir do pod), não dado sujo.

## Ver o resultado

- **Marts:** ClickHouse, `SELECT count() FROM <mart>` — ver [`scripts/audit.sql`](../scripts/audit.sql) para as queries de auditoria completas (ingestão → marts, OLA compliance, sequências P4).
- **Snapshot:** MLflow UI, `https://mlflow.ops-ahead.localtest.me`, experiment `data-pipeline-snapshots` — um run por execução da DAG, nomeado com o `dag-run-id` (nome do Workflow). Só existe pra runs da cadeia completa.
- **Data Docs (GE):** console MinIO, bucket `ops-ahead-lake`, prefixo `ge-docs/`.
