{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(date, source)',
        partition_by='toYYYYMM(date)'
    )
}}

-- Daily volume/composition features for the alert chain — what
-- ml-trainer.volume trains on (série de ocorrências que exigem trabalho,
-- separada do ruído), over silver_alert instead of the gone
-- stg_incidents/daily_anomaly_features. Not the same table as
-- gold_monitor_daily_features (Fase 4), which feeds the external event
-- detector off the monitor chain instead — volume forecast is about
-- managed incidents, mixing in monitor signal volume would blend two
-- different things.
select
    toDate(opened_at)                                               as date,
    source,
    count()                                                         as total_incidents,
    countIf(severity = 1)                                           as p1_count,
    countIf(severity = 2)                                           as p2_count,
    countIf(severity = 3)                                           as p3_count,
    countIf(severity = 1) / count()                                 as p1_share,
    countIf(severity <= 2) / count()                                as critical_share,
    uniqExact(entity_id)                                            as unique_entities,
    count() / uniqExact(entity_id)                                  as incidents_per_entity,
    countIf(parent_id = '')                                         as standalone_count,
    countIf(parent_id = '') / count()                               as standalone_share,
    countIf(reported_by = 'manual') / count()                       as manual_open_share,
    countIf(resolution_code = 'no_intervention') / count()          as no_intervention_share,
    avg(toHour(opened_at))                                          as avg_opened_hour,
    avg(duration_seconds)                                           as avg_duration_seconds,
    quantile(0.5)(duration_seconds)                                 as median_duration_seconds,
    quantile(0.95)(duration_seconds)                                as p95_duration_seconds
from {{ ref('silver_alert') }}
group by date, source
