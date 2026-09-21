{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, entity_id, date)',
        partition_by='toYYYYMM(date)'
    )
}}

-- Escalation: a signal strictly more severe than the one immediately before
-- it on the same entity — an early-warning pattern (severity climbing on a
-- resource ahead of a managed incident being opened for it), counted per day
-- so it aggregates the same way the other daily-grain features do.
with ordered as (

    select
        tenant_id,
        entity_id,
        received_at,
        severity,
        lagInFrame(severity) over (
            partition by tenant_id, entity_id order by received_at
        ) as prev_severity,
        row_number() over (
            partition by tenant_id, entity_id order by received_at
        ) as rn
    from {{ source('ingest', 'bronze_monitor') }}
    where severity is not null

)

select
    tenant_id,
    entity_id,
    toDate(received_at)                                        as date,
    countIf(rn > 1 and severity < prev_severity)                as escalation_count
from ordered
group by tenant_id, entity_id, date
