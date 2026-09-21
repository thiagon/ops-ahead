{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, entity_id, window_minutes, window_start)',
        partition_by='toYYYYMM(window_start)'
    )
}}

-- Signal count per entity per time window (15min / 1h / 6h) — counts events,
-- not deduplicated conditions: a condition that flaps five times in a window
-- is five signals, which is exactly the correlation strength this feeds.
-- toStartOfInterval needs a constant interval, so each window size gets its
-- own literal call (same pattern as the alert chain's entity-window counts).
{% for minutes in [15, 60, 360] %}
select
    tenant_id,
    entity_id,
    {{ minutes }}                                                    as window_minutes,
    toStartOfInterval(received_at, interval {{ minutes }} minute)    as window_start,
    count()                                                          as signal_count,
    countIf(condition = 'firing')                                    as firing_count,
    countIf(condition = 'cleared')                                   as cleared_count,
    uniqExact(external_id)                                           as distinct_conditions
from {{ source('ingest', 'bronze_monitor') }}
group by tenant_id, entity_id, window_start
{% if not loop.last %}union all{% endif %}
{% endfor %}
