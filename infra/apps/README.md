# Sync waves

ArgoCD has no `depends_on` between Applications — `argocd.argoproj.io/sync-wave`
(a bare integer) is the only ordering primitive, and it only orders resources
*within* a single sync operation (the app-of-apps root syncing all children
here counts as one). This table is the dependency graph the wave numbers
encode; keep it in sync when adding or reordering an app.

| Wave | App(s) | Waits on |
|------|--------|----------|
| -1 | `namespaces`, `project` | — (namespaces/quotas/network policies/AppProject must exist before anything schedules) |
| 0 | `infra-argocd` | -1 |
| 1 | `infra-vault` | 0 (secret backend must be reachable before `infra-secrets` wires a store to it) |
| 2 | `infra-eso`, `infra-keda` | 1 (operators/CRDs must be registered before anything creates a `ClusterSecretStore` or `ScaledObject`) |
| 3 | `infra-secrets` | 2 (creates the `vault-kv` `ClusterSecretStore` — every `ExternalSecret` below needs this) |
| 4 | `data-strimzi`, `infra-loki` | 3 (Strimzi's CRDs/operator must exist before `data-kafka`'s Kafka/Zookeeper CR; Loki has no real dependency) |
| 5 | `infra-gitea`, `infra-prometheus`, `data-clickhouse` | 3 (each only needs its own `ExternalSecret` to be resolvable) |
| 6 | `data-kafka`, `data-minio`, `infra-promtail` | 4 (Kafka needs the Strimzi operator) |
| 7 | `data-ingest`, `ml-redis`, `ml-postgres` | 5, 6 (data-ingest consumes Kafka, writes ClickHouse + MinIO) |
| 8 | `data-runner`, `ml-mlflow` | 6, 7 (data-runner's PreSync `dbt run` reads the bronze_* tables data-ingest migrates; mlflow needs its Postgres/Redis backends) |
| 9 | `data-deadline-tracker`, `ml-trainer`, `ml-burst-detector`, `ui-gateway`, `ui-frontend`, `ingresses` | 2, 6, 8 (the tracker's startup reads `tenant_deadlines`/`silver_alert_open`, seeded by data-runner's PreSync hook; KEDA-scaled consumers need infra-keda + Kafka; ingresses route to Services created by earlier waves) |
| 10 | `ml-model-serving` | 8 (serves models registered in MLflow) |

## Rules for chart-internal ordering (hooks vs. waves)

A wave only orders resources *within the same ArgoCD sync phase*. The
**PreSync phase always runs in full before any Sync-phase resource — wave
number included.** A `sync-wave` on a plain resource cannot get it applied
ahead of a `PreSync` hook in the same chart; if a `PreSync` hook (e.g. a
migration Job) reads a `Secret` that a normal `ExternalSecret` resource is
meant to populate, that `ExternalSecret` must itself be a `PreSync` hook
(with a lower `hook-weight`) or the hook will always run against stale data.
See `infra/charts/data-ingest/templates/external-secret.yaml` for the
pattern.

## Adding a new app

1. Pick the wave of whatever it depends on, and use the next wave after the
   *last* of those dependencies.
2. Add a row to the table above.
3. If it has both an `ExternalSecret` and a `PreSync` hook, check the rule
   above before assuming the wave number is enough.
