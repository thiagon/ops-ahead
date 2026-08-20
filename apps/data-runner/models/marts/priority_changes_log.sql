{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, source, external_id, received_at)',
        partition_by='toYYYYMM(received_at)'
    )
}}

-- Detects severity transitions between consecutive events for the same
-- occurrence — needs event grain (bronze_alert), not the collapsed
-- occurrence state in silver_alert.
with ordered as (

    select
        tenant_id,
        source,
        external_id,
        event_id,
        received_at,
        severity,
        row_number() over (
            partition by tenant_id, source, external_id order by received_at
        )                                                                     as rn,
        -- lagInFrame (ClickHouse's lag()) returns 0, not NULL, on a
        -- partition's first row — rn > 1 below is what filters it out.
        lagInFrame(severity) over (
            partition by tenant_id, source, external_id order by received_at
        )                                                                     as prev_severity
    from {{ source('ingest', 'bronze_alert') }}

)

select
    tenant_id,
    source,
    external_id,
    event_id,
    received_at,
    prev_severity as severity_from,
    severity      as severity_to
from ordered
where rn > 1
  and prev_severity != severity
