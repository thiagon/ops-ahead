# trigger-service

Serviço único que recebe um pedido de execução em linguagem de negócio (REST ou MCP) e
dispara, por trás, um `Workflow` (Argo) isolado e efêmero. Quem chama nunca precisa saber
que existe Kubernetes, Argo ou um `WorkflowTemplate` por trás — ver
`conductor/tracks/exec-trigger_20260807/spec.md` para a arquitetura completa.

## `POST /trigger`

Corpo discriminado pelo campo `analysis`. Responde `202 {"run_id": "<uuid>"}` na hora — o
`Workflow` ainda não existe nesse momento (publicado em Kafka; o consumer cria o `Workflow`
logo em seguida).

| `analysis` | Campos obrigatórios | Campos opcionais | O que roda |
|---|---|---|---|
| `volume_forecast` | `train_end`, `validation_end`, `holdout_end` (datas `YYYY-MM-DD`) | `data_source` | Treino do modelo de previsão de volume (`ml-trainer`, `ns: ml`) |
| `breach_risk` | `train_end`, `validation_end`, `holdout_end` | `data_source` | Treino do modelo de risco de breach de OLA (`ml-trainer`, `ns: ml`) |
| `data_refresh` | — | `data_source` | `dbt run` — materializa os marts (`data-runner`, `ns: data`) |
| `data_quality_check` | — | `data_source` | Suite Great Expectations `critical` (`data-runner`, `ns: data`) |

`data_source` é uma URL de override opcional (ex: `clickhouse://user:pass@host:9000/db`) —
sem ela, a execução usa a origem de dados padrão configurada no cluster. Nenhum outro campo
de infraestrutura (namespace, `WorkflowTemplate`, nome do `Workflow`) é aceito ou exposto:
esse mapeamento é interno (`src/dispatch.py`).

### Exemplos

```bash
curl -X POST https://trigger.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{
    "analysis": "volume_forecast",
    "train_end": "2025-09-30",
    "validation_end": "2025-10-31",
    "holdout_end": "2026-01-31"
  }'

curl -X POST https://trigger.ops-ahead.localtest.me/trigger \
  -H 'content-type: application/json' \
  -d '{"analysis": "data_quality_check"}'
```

## `GET /runs/{run_id}`

```bash
curl https://trigger.ops-ahead.localtest.me/runs/<run_id>
# {"run_id": "...", "status": "queued" | "Pending" | "Running" | "Succeeded" | "Failed" | "Error"}
```

`queued` significa que o pedido foi validado e publicado, mas o `Workflow` ainda não foi
criado pelo consumer — não é erro, é o estado normal logo após o `202`.

## `GET /health`

Liveness/readiness — não requer autenticação nem parâmetros.

## MCP

O mesmo contrato acima é exposto como tools MCP (`trigger_analysis`, `get_run_status`) no
transport HTTP em `/mcp`, montado sobre o mesmo processo/porta via `fastapi-mcp` — nenhuma
lógica de validação ou despacho duplicada em relação ao REST (ver `src/app.py`).
