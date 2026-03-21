# Challenge — AIOps Locaweb (FIAP Enterprise Challenge 2026)

## Project Overview

Predict and explain IT incident patterns using ML/data science on Locaweb's ITSM dataset. Goal: anticipate incident volume (D+1 and D+7), identify OLA breach risk, and support operational decisions.

## Setup

```bash
uv sync          # install dependencies
```

- Python 3.12+, managed with `uv`
- Processed data: `assets/incidents.csv` (already committed)

## Project Structure

```
assets/           # data files
  incidents.csv   # processed dataset (27 cols, snake_case)
docs/
  context/        # data dictionary
  sprints/        # sprint requirements
scripts/
  prepare_dataset.py  # Excel → CSV pipeline
```

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

## Sprint Deadlines

| Sprint | Due |
|--------|-----|
| Sprint 1 — Ideation | 2026-04-27 |
| Sprint 2 — Architecture + EDA | 2026-05-24 |
| Sprint 3 — MVP | 2026-08-23 |
| Sprint 4 — Final | 2026-09-08 |
