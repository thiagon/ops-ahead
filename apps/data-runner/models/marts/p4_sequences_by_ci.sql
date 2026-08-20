{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(entity_id, sequence_start)',
        partition_by='toYYYYMM(sequence_start)'
    )
}}

-- Consecutive P4 sequences per IC (islands-and-gaps via row_number diff),
-- over silver_alert — one row per occurrence, not per event.
with p4 as (
    select
        entity_id,
        external_id,
        opened_at,
        row_number() over (partition by entity_id order by opened_at) as rn_all,
        row_number() over (partition by entity_id order by opened_at) as rn_p4
    from {{ ref('silver_alert') }}
    where severity = 4 and entity_id is not null and entity_id != ''
),

sequenced as (
    select
        entity_id,
        external_id,
        opened_at,
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
    min(external_id)    as first_incident,
    max(external_id)    as last_incident
from sequenced
group by entity_id, sequence_group
