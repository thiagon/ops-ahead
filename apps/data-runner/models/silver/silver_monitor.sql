{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, source, external_id)',
        partition_by='toYYYYMM(started_at)'
    )
}}

-- Current state of the `monitor` chain — one row per condition, not per
-- event. started_at/ended_at come from the most recent event, describing
-- the current (or last) firing episode; recurrence_count looks across this
-- condition's own history, still within silver's "one occurrence" rule
-- (domain spec: Condição — cadeia monitor).
with events as (

    select *
    from {{ source('ingest', 'bronze_monitor') }}

),

ordered as (

    select
        *,
        lagInFrame(condition) over (
            partition by tenant_id, source, external_id order by received_at
        ) as prev_condition
    from events

),

recurrence_counts as (

    select
        tenant_id,
        source,
        external_id,
        countIf(condition = 'firing' and prev_condition != 'firing') as recurrence_count
    from ordered
    group by tenant_id, source, external_id

),

latest as (

    select
        tenant_id,
        source,
        external_id,
        argMax(entity_id, received_at)     as entity_id,
        argMax(severity, received_at)       as severity,
        argMax(condition, received_at)       as condition,
        argMax(title, received_at)            as title,
        argMax(description, received_at)       as description,
        argMax(labels, received_at)             as labels,
        argMax(source_url, received_at)          as source_url,
        argMax(started_at, received_at)           as started_at,
        argMax(ended_at, received_at)              as ended_at
    from events
    group by tenant_id, source, external_id

)

select
    l.tenant_id,
    l.source,
    l.external_id,
    l.entity_id,
    l.severity,
    l.condition,
    l.title,
    l.description,
    l.labels,
    l.source_url,
    l.started_at,
    l.ended_at,
    l.condition = 'firing'                                          as is_active,
    dateDiff('second', l.started_at, coalesce(l.ended_at, now64(3))) as duration_seconds,
    coalesce(rc.recurrence_count, 0)                                 as recurrence_count
from latest l
left join recurrence_counts rc
    on  rc.tenant_id = l.tenant_id
    and rc.source = l.source
    and rc.external_id = l.external_id
