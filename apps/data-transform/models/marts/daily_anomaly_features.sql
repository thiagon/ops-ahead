{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(date, source)',
        partition_by='toYYYYMM(date)'
    )
}}

-- Daily features for anomaly detection and ML training
select
    toDate(opened_at)                                               as date,
    source,
    count()                                                         as total_incidents,
    countIf(severity = 1)                                           as p1_count,
    countIf(severity = 2)                                           as p2_count,
    countIf(severity = 3)                                           as p3_count,
    countIf(severity = 1) / count()                                 as p1_share,
    countIf(severity <= 2) / count()                                as critical_share,
    countIf(counted_in_kpi = 1)                                     as kpi_count,
    countIf(kpi_breached = 1)                                       as breached_count,
    countIf(kpi_breached = 1) / nullIf(countIf(counted_in_kpi = 1), 0) as breach_rate,
    uniqExact(entity_id)                                            as unique_entities,
    count() / uniqExact(entity_id)                                  as incidents_per_entity,
    countIf(has_parent_incident = 0)                                as standalone_count,
    countIf(has_parent_incident = 0) / count()                      as standalone_share,
    avg(duration_seconds)                                           as avg_duration_seconds,
    quantile(0.5)(duration_seconds)                                 as median_duration_seconds,
    quantile(0.95)(duration_seconds)                                as p95_duration_seconds
from {{ ref('stg_incidents') }}
group by date, source
