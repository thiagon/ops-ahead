# Tech Stack

## Architecture

**Monorepo** — All components live in a single repository.

## Languages

| Language | Version | Purpose |
|----------|---------|---------|
| Python | 3.12+ | Data analysis, ML pipelines, workers |
| TypeScript | Node 24 | Gateway HTTP service (Fastify) — first Node/TS member of the monorepo |
| SQL | — | Data querying and analysis |

## Package Management

- **Python**: `uv` (fast dependency management, workspace root at `pyproject.toml`)
- **TypeScript**: `npm` (`package-lock.json`, `npm ci`) — never `pnpm`

## Ingest Gateway (`apps/ui-gateway`)

- **Fastify 5** + **Zod 4** (`fastify-type-provider-zod`) — validated in/out, OpenAPI at `/docs`
- **`@fastify/autoload`** — plugins/modules auto-registered, per `thiagon/template-fastify`
- **kafkajs** — producer plugin (`app.kafka`), publishes normalized events to `incidents.received`
- **HMAC** (`X-Signature: sha256=…`) — verifies inbound webhook signatures, toggled by `HMAC_ENABLED`
- **Prisma 7** (`prisma-client` + `@prisma/adapter-pg`) — database `gateway` na instância
  `config-postgres`; tabela `analyses` é a fonte de verdade de `GET /analyses/{id}`
- **Biome** (lint/format) + **vitest** (`unit`/`e2e`) — not ESLint/Jest

## Frontend (`apps/ui-frontend`)

- **React Router 7** (framework mode) — server-side loaders read the ClickHouse gold layer
  directly; no separate read model or API layer between the dashboard and the data
- **Vite** native build, **Node 24**, `npm`
- **Tailwind CSS 4** + **Biome** (lint/format) + **vitest** — same conventions as
  `apps/ui-gateway`
- **`@clickhouse/client`** (HTTP interface, port 8123) — server-only import, enforced by a
  test that scans the client bundle for the package name and any credential
- Design tokens (color, typography — Poppins/Inter/JetBrains Mono) extracted from
  `docs/presentations/`

## Backend / Processing

- **dbt-clickhouse** (`apps/data-runner`) — bronze/silver/gold marts, materialized as
  ClickHouse tables/views; no Airflow, no PySpark
- **Great Expectations** — data quality checks, same `data-runner` process
- Kafka-consuming services (`apps/data-ingest`, `apps/ml-trainer`, etc.) are all plain
  `deployment`s scaled by KEDA `ScaledObject`s — no Argo Workflows, no per-message Jobs

## Database

- **ClickHouse** (Altinity operator) — bronze/silver/gold incident data, read
  directly by `ui-frontend`'s loaders. No PostgreSQL for incident data.
- **PostgreSQL** (`config-postgres` in `ns: ui`) — two databases on one instance:
  the gateway (sources, mappings, deadlines, targets, analyses), and `authentik`.

## Infrastructure

- **Cloud-agnostic** deployment
- Preferred: **Kubernetes** or **Docker** (Compose for dev, K8s for production)

## Key Python Dependencies

- `pandas` — Data manipulation and analysis
- `openpyxl` — Excel file reading (dataset ingestion)
- Additional ML/DS dependencies to be added (scikit-learn, statsmodels, etc.)
