{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, source, external_id)',
        partition_by='toYYYYMM(opened_at)'
    )
}}

-- Current state of the `alert` chain — one row per occurrence, not per
-- event (domain spec: Silver — a ocorrência e a condição). The derivation
-- itself lives in the as_of macro so a past instant reconstructs the same
-- way as "now" (see silver_alert_as_of.sql).
{{ silver_alert_as_of() }}
