# Pipeline E2E Baseline

**Data:** —
**Dataset:** 1.000 eventos (itsm-locaweb)
**Ambiente:** k3d local

## Ingestão

| Métrica | Valor |
|---------|-------|
| Eventos postados pelo producer | — |
| Linhas em `incidents_raw` | — |
| Arquivos Parquet no MinIO | — |

## DAG (WorkflowTemplate data-pipeline)

| Step | Status | Duração |
|------|--------|---------|
| dbt-run | — | — |
| great-expectations | — | — |
| register-snapshot | — | — |

## Marts

| Mart | Linhas |
|------|--------|
| incidents_by_ic | — |
| p4_sequences_by_ci | — |
| first_touch_duration | — |
| priority_changes_log | — |
| daily_anomaly_features | — |
| kpi_monthly_state | — |

## Observações

_Preencher durante a execução._
