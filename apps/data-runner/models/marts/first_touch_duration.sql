{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(severity, owner, opened_at)',
        partition_by='toYYYYMM(opened_at)'
    )
}}

-- OLA compliance per closed, KPI-eligible occurrence — deadline_seconds is
-- the tenant's configured deadline for the severity, not a hardcoded
-- multiIf anymore — the deadline is per-tenant configuration.
select
    tenant_id,
    source,
    external_id,
    entity_id,
    owner,
    reported_by,
    parent_id != ''    as has_parent_incident,
    opened_at,
    closed_at,
    status,
    severity,
    duration_seconds,
    deadline_seconds,
    duration_seconds <= deadline_seconds as within_ola,
    is_eligible,
    has_breached
from {{ ref('silver_alert') }}
where is_eligible and closed_at is not null
