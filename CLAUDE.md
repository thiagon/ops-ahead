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
apps/                        # one folder per image you build; chart/ overlay colocated
  data-ingest/                # deployment (ns: data) — Kafka consumer → ClickHouse + MinIO, translation stage
  data-runner/                # deployment (ns: data) — dbt-clickhouse marts + Great Expectations, consumes trigger.data
  data-deadline-tracker/      # deployment (ns: data) — tracks open eligible incidents, emits deadline milestones to deadlines.milestone
  ml-trainer/                  # deployment (ns: ml) — volume/breach/external-event training, consumes trigger.ml
  ml-burst-detector/           # deployment (ns: ml) — consumes events.monitor, detects signal bursts per entity, publishes alerts.burst
  ml-model-serving/            # deployment (ns: ml) — BentoML serving for the volume/breach models registered in MLflow
  ui-gateway/                  # deployment (ns: ui) — HTTP boundary: webhooks → events.raw.*; POST /analyses → trigger.ml/trigger.data; GET /analyses from Postgres
contracts/                   # shared JSON Schemas (event-envelope, incident-alert, condition-monitor, deadline-milestone, translation-dictionary, trigger-*.schema.json)
domain/                      # domain specs (SDD): language, contexts, ACLs
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
  insights/                  # EDA and design analyses referenced by track specs
  sprints/                   # sprint requirements
```

## Workload natures

One folder per image in `apps/`. Its **nature** — declared in `apps/<app>/chart/app.yaml`
(`workload`, `namespace`) — decides how it runs. The deploy overlay lives alongside it in
the same `chart/`, in `values-dev.yaml` — the same file the CI write-back pins
`<app>.image.tag` into (there is no separate `values-image.yaml`):

| `workload` | Runtime | Own ArgoCD App? | Image tag lives in |
|------------|---------|-----------------|--------------------|
| `deployment` | Deployment (stays up) | yes | `apps/<app>/chart/values-dev.yaml` |
| `cronjob` | native CronJob at schedule X | yes | same, plus `schedule` in the overlay |
| `job` | Job, run once on demand | yes | same |

There is no `pipeline-step` nature anymore, and no `pipelines/` folder — both existed
only to configure the Argo Workflows engine (`infra/charts/data-workflows`), removed in
`exec-trigger_20260807`. There is also no `scaledjob` nature anymore: a `Job`-shaped
object minted per message has no owner that outlives the controller managing it, so it
can leak indefinitely if that controller is ever decommissioned. Every Kafka-consuming
app is a plain `deployment` instead, and a KEDA `ScaledObject` (not `ScaledJob`) scales
its **replica count** — down to `minReplicaCount: 0` when idle, same as before, but the
unit that scales is pods of one long-running consumer process, never a new object minted
per message. Ordering between
steps that used to be "a pipeline's job" is now either sequential code inside one
consumer's message handler (`data-runner`'s `analysis: full_pipeline`, see below) or simply
doesn't exist (`ml-trainer` trains one model per message, no chaining).

**On-demand execution** goes through `ui-gateway` (`deployment`, `ns: ui`) — the
single REST/MCP entry point. It validates a business-language payload (`analysis` +
parameters), mints an `id`, persists `pending` in Postgres, and publishes to `trigger.ml`
or `trigger.data` (Kafka, `ns: data`) — never touches Kubernetes. `ml-trainer`/`data-runner`
(`deployment`) each own a KEDA `ScaledObject` that scales their replica count from that
topic's lag: **no application process ever creates a Kubernetes resource** — only the
KEDA operator (`infra/charts/infra-keda`, installed once, `ns: infra`) does, which is
platform infra, not code this team writes. Each message handler publishes `running` then
a terminal status (`succeeded`/`failed`) to the compacted `trigger.status` topic;
`ui-gateway` upserts those into its own database on the `config-postgres` instance and
answers `GET /analyses/{id}` from Postgres. The consumer group on `trigger.status` is
**fixed** (`gateway-trigger-status`) — Postgres is the source of truth, so a restart
resumes from the committed offset. This is the same rule as `data-runner`/`ml-trainer`'s
own consumer group on `trigger.data`/`trigger.ml`.

The **daily data chain** (`dbt run → great_expectations → register-snapshot`) is the same
mechanism, not a parallel one: a native `CronJob` (`ns: data`, part of `data-runner`'s own
chart) publishes `{"run_id": "daily-<date>", "analysis": "full_pipeline"}` to
`trigger.data` on schedule — `full_pipeline` is vocabulary the `CronJob` uses internally,
never accepted from `POST /analyses`. Full contract of every payload/topic:
`conductor/tracks/exec-trigger_20260807/payloads.md`; JSON Schema in `contracts/trigger-*.schema.json`.

## uv Workspaces

Root `pyproject.toml` is the workspace root. Members: `scripts/`, `apps/*`. Single `uv.lock` covers all.

To run a command scoped to one app:
```bash
uv run --package ops-ahead-data-ingest pytest
```
`--package` only selects the venv — `pytest` still discovers from the invocation
directory. Run from the repo root without a path and it collects every app's `tests/`
and collides on the `tests.*` module namespace. Pass the app's test path explicitly:
```bash
uv run --package ops-ahead-data-ingest pytest apps/data-ingest/tests
```

## Infrastructure

Stack runs on Kubernetes (k3s via k3d). All changes go via GitOps — edit files → push → ArgoCD syncs. Never `kubectl exec`, `curl`, or direct API calls to the cluster.

**Scripts in `infra/scripts/` never carry a hardcoded list.** Apps, charts, namespaces and
secrets are discovered — `kubectl ... --all` in the cluster, a glob over the manifests that
already declare it in the repo (`apps/*/chart/values-dev.yaml`,
`infra/charts/*/templates/external-secret.yaml`, `infra/apps/namespaces.yaml`). Adding a
service must not require editing a script; if it does, fix the script — replace the list
with a glob, never append to it. Rules and the add-a-service flow: `infra/scripts/README.md`.

`kube-prometheus-stack` bundles Grafana inside the `infra-prometheus` chart. The credentials in that chart (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`) are for Grafana, not Prometheus. Prometheus UI has no native authentication — it is exposed without credentials in dev and protected by NetworkPolicy.

## Dataset Key Fields

`assets/incidents.csv` is the original Locaweb base and keeps its Portuguese
column names. It exists to feed mocks — nothing else reads it.

| Field | Description |
|-------|-------------|
| `prioridade_codigo` | 1=Critical, 2=High, 3=Medium, 4=Low, 5=Very Low |
| `aberto_em` | Incident open datetime |
| `duracao_segundos` | Resolution time in seconds |
| `entrou_kpi` | 1 if counted in KPI (0 if parent incident or "Sem Intervenção") |
| `kpi_violado` | 1 if OLA was breached |

## Domain

`domain/` holds the domain specs. Read them before naming anything — a new
field, table, topic or metric — and before deciding how a context talks to
another. They describe business intent, never implementation.

| Document | Answers |
|----------|---------|
| `domain/ubiquitous-language.md` | What each term means and which word to use |
| `domain/context-map.md` | Which bounded contexts exist and how they integrate |
| `domain/contexts/integration.md` | The integration context: purpose, business decisions, open questions |
| `domain/acl/itsm.md` | What the ITSM speaks and how it is translated — including where Portuguese is allowed to exist |

Schema of record lives in `contracts/`; domain specs reference it, never repeat
it. Business rules of the Locaweb dataset live in `docs/context/data-dictionary.md`.

## KPI / OLA Rules

Quick reference; `docs/context/data-dictionary.md` is authoritative.

- Only priorities 1, 2, 3 are measured
- Excluded from KPI: `incidente_pai` filled OR `status == "Sem Intervenção"`
- Time limits: P1/P2 ≤ 4h · P3 ≤ 12h · P4 ≤ 24h · P5 ≤ 96h

## Conventions

- **Commit messages**: always in English, following Conventional Commits
- **Code and comments**: English
- **Docs and specs** (`conductor/`, `docs/`): Portuguese
- **Comment scope**: only for something genuinely hard to understand — a library quirk, a
  non-obvious invariant, a subtle mechanism of a tool (e.g. ArgoCD's PreSync phase always
  running before any Sync-phase resource, wave number included). Never repeat naming or
  convention already centralized in `domain/`, `CLAUDE.md`, or another doc — reference it
  instead. Never narrate the bug, incident, or investigation that motivated the change
  ("X got stuck because of Y", "this is what happened when Z was removed") — a comment
  describes the invariant that holds going forward, not the history of how it was found.
  Never reference a conductor task/phase number. If the same explanation would apply to
  many files of the same kind (e.g. why each Application sits at a given sync-wave), it
  belongs in one reference doc for that directory, not repeated per file.

## Sprint Deadlines

| Sprint | Due |
|--------|-----|
| Sprint 1 — Ideation | 2026-04-27 |
| Sprint 2 — Architecture + EDA | 2026-05-24 |
| Sprint 3 — MVP | 2026-08-23 |
| Sprint 4 — Final | 2026-09-08 |
