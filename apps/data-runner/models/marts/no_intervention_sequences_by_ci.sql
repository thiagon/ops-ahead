{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(entity_id, sequence_start)',
        partition_by='toYYYYMM(sequence_start)'
    )
}}

-- Consecutive resolution_code = 'no_intervention' sequences per IC
-- (islands-and-gaps via row_number diff), over silver_alert — one row per
-- occurrence, not per event. This is the predictive signal
-- docs/context/kickoff-challenge-locaweb.md §4 describes ("Gatilhamento
-- Preditivo": repeated auto-resolved failures on a CI ahead of a P2 drop) —
-- resolution_code, not severity, which is an unrelated passthrough.
with no_intervention as (
    select
        entity_id,
        external_id,
        opened_at,
        row_number() over (partition by entity_id order by opened_at) as rn_all,
        row_number() over (partition by entity_id order by opened_at) as rn_ni
    from {{ ref('silver_alert') }}
    where resolution_code = 'no_intervention' and entity_id is not null and entity_id != ''
),

sequenced as (
    select
        entity_id,
        external_id,
        opened_at,
        rn_ni,
        rn_all - rn_ni as sequence_group
    from no_intervention
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
