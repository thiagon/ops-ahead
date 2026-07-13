{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(month, severity, source)',
        partition_by='toYYYYMM(month)'
    )
}}

-- Monthly KPI state per severity × source — primary ML label source
select
    toStartOfMonth(opened_at)                                       as month,
    severity,
    source,
    count()                                                         as total,
    countIf(entrou_kpi = 1)                                         as in_kpi,
    countIf(kpi_violado = 1)                                        as violated,
    countIf(entrou_kpi = 1 and kpi_violado = 0)                     as compliant,
    countIf(kpi_violado = 1) / nullIf(countIf(entrou_kpi = 1), 0)  as violation_rate,
    avg(duracao_segundos)                                           as avg_duration_seconds,
    quantile(0.5)(duracao_segundos)                                 as median_duration_seconds,
    quantile(0.95)(duracao_segundos)                                as p95_duration_seconds
from {{ ref('stg_incidents') }}
where severity in (1, 2, 3)
group by month, severity, source
