{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(entity_id)'
    )
}}

-- Median and dispersion of the time between consecutive signals on an
-- entity, across every condition on it — not just within one external_id,
-- since the correlation question is "how often does this entity make noise
-- at all", not "how often does this one trigger repeat".
with ordered as (

    -- lagInFrame returns the column's default (epoch), not NULL, on a
    -- partition's first row — row_number is what filters that row out below,
    -- same reasoning as priority_changes_log.sql.
    select
        entity_id,
        received_at,
        lagInFrame(received_at) over (
            partition by entity_id order by received_at
        ) as prev_received_at,
        row_number() over (
            partition by entity_id order by received_at
        ) as rn
    from {{ source('ingest', 'bronze_monitor') }}

),

intervals as (

    select
        entity_id,
        dateDiff('second', prev_received_at, received_at) as interval_seconds
    from ordered
    where rn > 1

)

select
    entity_id,
    count()                                as interval_count,
    quantile(0.5)(interval_seconds)        as median_interval_seconds,
    stddevPop(interval_seconds)            as interval_stddev_seconds
from intervals
group by entity_id
