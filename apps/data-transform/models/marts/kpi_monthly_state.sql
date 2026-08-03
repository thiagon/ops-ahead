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
    countIf(counted_in_kpi = 1)                                         as in_kpi,
    countIf(kpi_breached = 1)                                        as violated,
    countIf(counted_in_kpi = 1 and kpi_breached = 0)                     as compliant,
    countIf(kpi_breached = 1) / nullIf(countIf(counted_in_kpi = 1), 0)  as violation_rate,
    avg(duration_seconds)                                           as avg_duration_seconds,
    quantile(0.5)(duration_seconds)                                 as median_duration_seconds,
    quantile(0.95)(duration_seconds)                                as p95_duration_seconds
from {{ ref('stg_incidents') }}
where severity in (1, 2, 3)
group by month, severity, source
