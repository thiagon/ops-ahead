{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(entity_id, window_hours, window_start)',
        partition_by='toYYYYMM(window_start)'
    )
}}

-- Incident count per IC per time window (1h / 6h / 24h)
select
    entity_id,
    window_hours,
    toStartOfInterval(opened_at, interval window_hours hour) as window_start,
    count()                                                   as incident_count,
    countIf(severity = 1)                                     as p1_count,
    countIf(severity = 2)                                     as p2_count,
    countIf(severity = 3)                                     as p3_count,
    countIf(severity <= 2)                                    as critical_count,
    countIf(kpi_violado = 1)                                  as violated_count,
    avg(duracao_segundos)                                     as avg_duration_seconds
from {{ ref('stg_incidents') }}
cross join (
    select arrayJoin([1, 6, 24]) as window_hours
) as w
group by entity_id, window_hours, window_start
