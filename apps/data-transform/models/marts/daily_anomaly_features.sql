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
    countIf(entrou_kpi = 1)                                         as kpi_count,
    countIf(kpi_violado = 1)                                        as violated_count,
    countIf(kpi_violado = 1) / nullIf(countIf(entrou_kpi = 1), 0)  as violation_rate,
    uniqExact(entity_id)                                            as unique_entities,
    count() / uniqExact(entity_id)                                  as incidents_per_entity,
    countIf(tem_incidente_pai = 0)                                  as standalone_count,
    countIf(tem_incidente_pai = 0) / count()                        as standalone_share,
    avg(duracao_segundos)                                           as avg_duration_seconds,
    quantile(0.5)(duracao_segundos)                                 as median_duration_seconds,
    quantile(0.95)(duracao_segundos)                                as p95_duration_seconds
from {{ ref('stg_incidents') }}
group by date, source
