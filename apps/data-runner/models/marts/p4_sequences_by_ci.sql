{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(entity_id, sequence_start)',
        partition_by='toYYYYMM(sequence_start)'
    )
}}

-- Consecutive P4 sequences per IC (islands-and-gaps via row_number diff)
with p4 as (
    select
        entity_id,
        event_id,
        opened_at,
        ticket_number,
        row_number() over (partition by entity_id order by opened_at) as rn_all,
        row_number() over (partition by entity_id order by opened_at) as rn_p4
    from {{ ref('stg_incidents') }}
    where severity = 4
),

sequenced as (
    select
        entity_id,
        event_id,
        opened_at,
        ticket_number,
        rn_p4,
        rn_all - rn_p4 as sequence_group
    from p4
)

select
    entity_id,
    sequence_group,
    min(opened_at)      as sequence_start,
    max(opened_at)      as sequence_end,
    count()             as sequence_length,
    min(ticket_number)  as first_incident,
    max(ticket_number)  as last_incident
from sequenced
group by entity_id, sequence_group
