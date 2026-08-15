{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(ticket_number, received_at)',
        partition_by='toYYYYMM(received_at)'
    )
}}

-- Detects severity transitions between consecutive events for the same incident number
with ordered as (
    select
        ticket_number,
        event_id,
        received_at,
        severity,
        row_number() over (partition by ticket_number order by received_at)     as rn,
        -- lagInFrame (ClickHouse's lag()) returns 0, not NULL, on a
        -- partition's first row — rn > 1 below is what filters it out.
        lagInFrame(severity) over (partition by ticket_number order by received_at) as prev_severity
    from {{ ref('stg_incidents') }}
)

select
    ticket_number,
    event_id,
    received_at,
    prev_severity as severity_from,
    severity      as severity_to
from ordered
where rn > 1
  and prev_severity != severity
