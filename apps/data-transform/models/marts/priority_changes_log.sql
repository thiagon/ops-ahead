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
        lag(severity) over (partition by ticket_number order by received_at) as prev_severity
    from {{ ref('stg_incidents') }}
)

select
    ticket_number,
    event_id,
    received_at,
    prev_severity as severity_from,
    severity      as severity_to
from ordered
where prev_severity is not null
  and prev_severity != severity
