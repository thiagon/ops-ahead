{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(entity_id, window_hours, window_start)',
        partition_by='toYYYYMM(window_start)'
    )
}}

-- Incident count per IC per time window (1h / 6h / 24h), over silver_alert —
-- one row per occurrence, not per event, so a recategorized incident is
-- counted once. toStartOfInterval needs a constant interval, so each window
-- size gets its own literal call.
{% for hours in [1, 6, 24] %}
select
    entity_id,
    {{ hours }}                                               as window_hours,
    toStartOfInterval(opened_at, interval {{ hours }} hour)   as window_start,
    count()                                                   as incident_count,
    countIf(severity = 1)                                     as p1_count,
    countIf(severity = 2)                                     as p2_count,
    countIf(severity = 3)                                     as p3_count,
    countIf(severity <= 2)                                    as critical_count,
    countIf(has_breached)                                     as breached_count,
    countIf(resolution_code = 'no_intervention')               as no_intervention_count,
    avg(duration_seconds)                                     as avg_duration_seconds
from {{ ref('silver_alert') }}
where entity_id is not null and entity_id != ''
group by entity_id, window_start
{% if not loop.last %}union all{% endif %}
{% endfor %}
