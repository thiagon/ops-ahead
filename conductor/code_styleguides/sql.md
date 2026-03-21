# SQL Style Guide

## General Rules

- Use uppercase for SQL keywords (`SELECT`, `FROM`, `WHERE`)
- Use `snake_case` for table and column names
- One clause per line for readability
- Indent subqueries and joins

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Tables | `snake_case`, plural | `incidents`, `ola_breaches` |
| Columns | `snake_case` | `prioridade_codigo`, `aberto_em` |
| Primary keys | `id` or `<table>_id` | `incident_id` |
| Foreign keys | `<referenced_table>_id` | `category_id` |
| Indexes | `idx_<table>_<columns>` | `idx_incidents_aberto_em` |
| Views | `vw_<name>` | `vw_daily_volume` |
| CTEs | Descriptive `snake_case` | `daily_counts` |

## Formatting

```sql
SELECT
    i.incident_id,
    i.prioridade_codigo,
    i.aberto_em,
    i.duracao_segundos,
    i.kpi_violado
FROM incidents i
WHERE i.entrou_kpi = 1
    AND i.prioridade_codigo IN (1, 2, 3)
ORDER BY i.aberto_em DESC
LIMIT 100;
```

## Best Practices

- Prefer CTEs over nested subqueries for readability
- Always qualify column names with table aliases in joins
- Use explicit `JOIN` syntax, never implicit joins in `WHERE`
- Add comments for complex business logic

```sql
-- Only incidents that count toward KPI (excludes parent incidents
-- and "Sem Intervenção" status)
WITH kpi_incidents AS (
    SELECT *
    FROM incidents
    WHERE entrou_kpi = 1
)
SELECT
    DATE(aberto_em) AS incident_date,
    COUNT(*) AS total_incidents,
    SUM(kpi_violado) AS breached_count
FROM kpi_incidents
GROUP BY DATE(aberto_em)
ORDER BY incident_date;
```

## PostgreSQL Specifics

- Use `TIMESTAMPTZ` for all datetime columns
- Use `TEXT` over `VARCHAR` unless length constraint is meaningful
- Leverage `JSONB` for semi-structured data when appropriate
- Use `GENERATED ALWAYS AS IDENTITY` for auto-increment PKs
