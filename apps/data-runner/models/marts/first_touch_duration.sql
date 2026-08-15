{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(severity, assignment_group, opened_at)',
        partition_by='toYYYYMM(opened_at)'
    )
}}

-- OLA limits by severity (seconds)
-- P1/P2: 4h | P3: 12h | P4: 24h | P5: 96h
select
    event_id,
    entity_id,
    ticket_number,
    opened_at,
    assignment_group,
    opened_by,
    has_parent_incident,
    status,
    severity,
    duration_seconds,
    multiIf(
        severity in (1, 2), 14400,
        severity = 3,        43200,
        severity = 4,        86400,
                             345600
    )                                                               as ola_limit_seconds,
    duration_seconds <= multiIf(
        severity in (1, 2), 14400,
        severity = 3,        43200,
        severity = 4,        86400,
                             345600
    )                                                               as within_ola,
    counted_in_kpi,
    kpi_breached
from {{ ref('stg_incidents') }}
where counted_in_kpi = 1
