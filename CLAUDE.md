# Challenge — AIOps Locaweb (FIAP Enterprise Challenge 2026)

## Project Overview

Predict and explain IT incident patterns using ML/data science on Locaweb's ITSM dataset. Goal: anticipate incident volume (D+1 and D+7), identify OLA breach risk, and support operational decisions.

## Setup

```bash
uv sync          # install all workspace dependencies
```

- Python 3.12+, monorepo managed with `uv` workspaces
- Processed data: `assets/incidents.csv` (already committed)

## Project Structure

```
apps/                        # services and jobs that go to K8s
  data-ingest/               # Deployment (ns: data) — Kafka consumer → ClickHouse + MinIO
  data-transform/            # Job (ns: data) — dbt-clickhouse marts
  data-quality/              # Job (ns: data) — Great Expectations suites
contracts/                   # shared JSON Schemas (incidents-raw.schema.json)
scripts/                     # local utilities, never go to K8s
  prepare_dataset.py         # Excel → CSV pipeline
  incident_producer.py       # mock: publishes assets/incidents.csv to Kafka
assets/
  incidents.csv              # processed dataset (27 cols, snake_case)
infra/
  charts/                    # Helm charts, one per namespace prefix (data-*, ml-*, ui-*, infra-*)
  apps/                      # ArgoCD Application manifests
  bootstrap/                 # root-app (app-of-apps)
  scripts/                   # dev-setup.sh, dev-up.sh, dev-down.sh
docs/
  context/                   # data dictionary
  sprints/                   # sprint requirements
```

Each app in `apps/` declares its K8s workload type and namespace in `[tool.ops-ahead]` inside its `pyproject.toml`.

## uv Workspaces

Root `pyproject.toml` is the workspace root. Members: `scripts/`, `apps/*`. Single `uv.lock` covers all.

To run a command scoped to one app:
```bash
uv run --package ops-ahead-data-ingest pytest
```

## Infrastructure

Stack runs on Kubernetes (k3s via k3d). All changes go via GitOps — edit files → push → ArgoCD syncs. Never `kubectl exec`, `curl`, or direct API calls to the cluster.

`kube-prometheus-stack` bundles Grafana inside the `infra-prometheus` chart. The credentials in that chart (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`) are for Grafana, not Prometheus. Prometheus UI has no native authentication — it is exposed without credentials in dev and protected by NetworkPolicy.

## Dataset Key Fields

| Field | Description |
|-------|-------------|
| `prioridade_codigo` | 1=Critical, 2=High, 3=Medium, 4=Low, 5=Very Low |
| `aberto_em` | Incident open datetime |
| `duracao_segundos` | Resolution time in seconds |
| `entrou_kpi` | 1 if counted in KPI (0 if parent incident or "Sem Intervenção") |
| `kpi_violado` | 1 if OLA was breached |

## KPI / OLA Rules

- Only priorities 1, 2, 3 are measured
- Excluded from KPI: `incidente_pai` filled OR `status == "Sem Intervenção"`
- Time limits: P1/P2 ≤ 4h · P3 ≤ 12h · P4 ≤ 24h · P5 ≤ 96h

## Conventions

- **Commit messages**: always in English, following Conventional Commits
- **Code and comments**: English
- **Docs and specs** (`conductor/`, `docs/`): Portuguese

## Sprint Deadlines

| Sprint | Due |
|--------|-----|
| Sprint 1 — Ideation | 2026-04-27 |
| Sprint 2 — Architecture + EDA | 2026-05-24 |
| Sprint 3 — MVP | 2026-08-23 |
| Sprint 4 — Final | 2026-09-08 |
