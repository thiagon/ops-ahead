{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(severity, grupo_designado, opened_at)',
        partition_by='toYYYYMM(opened_at)'
    )
}}

-- OLA limits by severity (seconds)
-- P1/P2: 4h | P3: 12h | P4: 24h | P5: 96h
select
    event_id,
    entity_id,
    numero,
    opened_at,
    grupo_designado,
    severity,
    duracao_segundos,
    multiIf(
        severity in (1, 2), 14400,
        severity = 3,        43200,
        severity = 4,        86400,
                             345600
    )                                                               as ola_limit_seconds,
    duracao_segundos <= multiIf(
        severity in (1, 2), 14400,
        severity = 3,        43200,
        severity = 4,        86400,
                             345600
    )                                                               as within_ola,
    entrou_kpi,
    kpi_violado
from {{ ref('stg_incidents') }}
where entrou_kpi = 1
