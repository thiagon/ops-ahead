# Pipeline de Dados — Operação

Como disparar a DAG `data-pipeline` manualmente, inspecionar falhas e rerodar um step.
Detalhes de schema e nomenclatura estão em [`contracts/`](../contracts/) e
[`domain/`](../domain/) — este documento é só operação.

## O que a DAG faz

`WorkflowTemplate` chamada `data-pipeline`, definida em
[`infra/charts/data-pipeline/templates/workflowtemplate.yaml`](../infra/charts/data-pipeline/templates/workflowtemplate.yaml),
rodando no `ns: data`:

```
dbt-run  →  great-expectations  →  register-snapshot
```

- **`dbt-run`** — `dbt run --profiles-dir /dbt` na imagem `data-transform`. Materializa `staging → marts` sobre `incidents_received`.
- **`great-expectations`** — imagem `data-quality`, roda a suite `critical` (`--suite critical --upload-docs`). Falha crítica interrompe a DAG antes do próximo step — `register-snapshot` nunca roda sobre dado que não passou na suite.
- **`register-snapshot`** — script Python inline: soma `SELECT count()` dos 6 marts, tira SHA-256 do dicionário de contagens e registra um MLflow run no experiment `data-pipeline-snapshots` (params `hash`/`dag_run_id`, tag `source`, uma métrica por mart).

A pipeline é configurada em [`pipelines/data-itsm-daily/`](../pipelines/data-itsm-daily/)
(`values.yaml` — source, marts do snapshot, cron; `appset.yaml` — chart base + overlays de imagem).
Em dev, `cron.enabled: false`: a DAG só roda por disparo manual. Em prod, `CronWorkflow`
`data-pipeline-daily` dispara às 02:00 UTC.

## Disparar manualmente

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
argo logs <workflow-name> -n data -c <step>      # logs do container do step (dbt-run | great-expectations | register-snapshot)
```

Falha em `great-expectations` — a suite `critical` imprime `describe_dict()` da validação
(JSON com cada expectation e se passou) antes de sair com código != 0; os Data Docs
completos ficam em `s3://ops-ahead-lake/ge-docs/` (console MinIO em
`https://minio.ops-ahead.localtest.me`).

Falha em `register-snapshot` — o step só roda depois da suite `critical` passar, então uma
falha aqui é infra (ClickHouse ou MLflow inacessíveis a partir do pod), não dado sujo.

## Rerodar um step

Argo Workflows não reinicia um step isolado de um workflow já finalizado — um `argo submit`
sempre roda a sequência inteira do zero. Para rerodar após corrigir a causa da falha:

```bash
argo submit --from workflowtemplate/data-pipeline -n data --watch
```

`dbt-run` e `great-expectations` são idempotentes (materializam/validam o estado atual das
tabelas); `register-snapshot` sempre cria um novo MLflow run, então rodar de novo depois de
uma falha não duplica nem corrompe snapshots anteriores.

## Ver o resultado

- **Marts:** ClickHouse, `SELECT count() FROM <mart>` — ver [`scripts/audit.sql`](../scripts/audit.sql) para as queries de auditoria completas (ingestão → marts, OLA compliance, sequências P4).
- **Snapshot:** MLflow UI, `https://mlflow.ops-ahead.localtest.me`, experiment `data-pipeline-snapshots` — um run por execução da DAG, nomeado com o `dag-run-id` (nome do Workflow).
- **Data Docs (GE):** console MinIO, bucket `ops-ahead-lake`, prefixo `ge-docs/`.
