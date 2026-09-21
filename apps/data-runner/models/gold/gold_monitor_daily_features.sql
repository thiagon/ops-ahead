{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, date, source)',
        partition_by='toYYYYMM(date)'
    )
}}

-- Daily volume/dispersion/severity-share features for the external event
-- detector (domain/ubiquitous-language.md#external-event) — same grain and
-- purpose as the alert chain's daily_anomaly_features, sourced from the
-- monitor chain instead.
select
    tenant_id,
    toDate(received_at)                                             as date,
    source,
    count()                                                         as total_signals,
    uniqExact(entity_id)                                            as unique_entities,
    count() / uniqExact(entity_id)                                  as signals_per_entity,
    countIf(condition = 'firing')                                   as firing_count,
    countIf(condition = 'cleared')                                  as cleared_count,
    countIf(severity = 1) / count()                                 as p1_share,
    countIf(severity <= 2) / count()                                as critical_share
from {{ source('ingest', 'bronze_monitor') }}
group by tenant_id, date, source
