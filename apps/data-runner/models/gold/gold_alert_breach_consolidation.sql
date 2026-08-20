{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, source, external_id)',
        partition_by='toYYYYMM(opened_at)'
    )
}}

-- One row per closed occurrence — duration, whether it breached, and by how
-- much. The verdict is silver_alert's, derived from the deadline vigente at
-- close, never received from the origin.
--
-- closed_at is Nullable in silver_alert's schema even though the WHERE
-- below guarantees it's set here — MergeTree partition keys reject
-- Nullable columns, so this partitions by the always-present opened_at
-- instead.
select
    tenant_id,
    source,
    external_id,
    severity,
    owner,
    opened_at,
    closed_at,
    duration_seconds,
    deadline_seconds,
    has_breached,
    greatest(duration_seconds - deadline_seconds, 0) as overage_seconds,
    is_eligible
from {{ ref('silver_alert') }}
where closed_at is not null
