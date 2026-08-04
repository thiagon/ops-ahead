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
- **prom-client** — `/metrics` (events published, HMAC/Kafka failures)
- **Biome** (lint/format) + **vitest** (`unit`/`e2e`) — not ESLint/Jest

## Frontend

- **Nuxt** (Vue-based) — Lightweight configuration interface only; no heavy dashboards

## Data Visualization

- Code-based dataviz tool (flexible, to be selected — e.g., Observable, Evidence, Streamlit, or similar)
- Analysis results and ML outputs rendered via dataviz layer, not the Nuxt frontend

## Backend / Processing

- No traditional API framework
- **Workers** for schedulable ML jobs
- **PySpark** for distributed data processing
- **Airflow** for pipeline orchestration and scheduling

## Database

- **PostgreSQL** — Structured incident data, scheduling state, analysis results

## Infrastructure

- **Cloud-agnostic** deployment
- Preferred: **Kubernetes** or **Docker** (Compose for dev, K8s for production)

## Key Python Dependencies

- `pandas` — Data manipulation and analysis
- `openpyxl` — Excel file reading (dataset ingestion)
- Additional ML/DS dependencies to be added (scikit-learn, statsmodels, etc.)
