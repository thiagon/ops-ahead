# Tech Stack

## Architecture

**Monorepo** — All components live in a single repository.

## Languages

| Language | Version | Purpose |
|----------|---------|---------|
| Python | 3.12+ | Data analysis, ML pipelines, workers |
| TypeScript | Latest | Configuration interface (Nuxt) |
| SQL | — | Data querying and analysis |

## Package Management

- **Python**: `uv` (fast dependency management)
- **TypeScript**: To be defined (npm/pnpm)

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
