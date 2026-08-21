{% macro silver_alert_as_of(cutoff='now64(3)') %}

{#
  One row per occurrence, (tenant_id, source, external_id), as it stood at
  `cutoff` — reconstructed straight from bronze_alert, never from the live
  silver_alert table, so a past state does not depend on today's state
  (domain spec: Silver — a ocorrência e a condição). `silver_alert.sql` calls
  this with the default cutoff for "now"; anything reconstructing training
  rows at a past marker calls it with an explicit timestamp expression.
#}

with events as (

    select *
    from {{ source('ingest', 'bronze_alert') }}
    where received_at <= {{ cutoff }}

),

-- Column list explicit (not `select *`) — ClickHouse 24.3 fails to resolve
-- the PARTITION BY columns for these window functions when the SELECT list
-- also expands a `*`.
ordered as (

    select
        tenant_id,
        source,
        external_id,
        received_at,
        severity,
        lagInFrame(severity) over (
            partition by tenant_id, source, external_id order by received_at
        )                                                                   as prev_severity,
        row_number() over (
            partition by tenant_id, source, external_id order by received_at
        )                                                                   as rn
    from events

),

severity_change_counts as (

    select
        tenant_id,
        source,
        external_id,
        countIf(rn > 1 and prev_severity != severity) as severity_changes
    from ordered
    group by tenant_id, source, external_id

),

-- Every passthrough field takes the most recent event's value — including
-- the lifecycle timestamps the origin sent (opened_at, and its own
-- acknowledged_at/resolved_at/closed_at when present).
latest as (

    select
        tenant_id,
        source,
        external_id,
        argMax(severity, received_at)             as severity,
        argMax(status, received_at)                as status,
        argMax(entity_id, received_at)              as entity_id,
        argMax(title, received_at)                   as title,
        argMax(description, received_at)             as description,
        argMax(owner, received_at)                    as owner,
        argMax(reported_by, received_at)               as reported_by,
        argMax(parent_id, received_at)                  as parent_id,
        argMax(resolution_code, received_at)             as resolution_code,
        argMax(resolution_summary, received_at)           as resolution_summary,
        argMax(labels, received_at)                        as labels,
        argMax(source_url, received_at)                     as source_url,
        argMax(opened_at, received_at)                       as opened_at,
        argMax(acknowledged_at, received_at)                  as origin_acknowledged_at,
        argMax(resolved_at, received_at)                       as resolved_at,
        argMax(closed_at, received_at)                          as origin_closed_at
    from events
    group by tenant_id, source, external_id

),

-- Fallback signals for when the origin never sends
-- acknowledged_at/closed_at (domain spec: silver derives them from the
-- first matching transition instead). Kept in its own CTE — mixing this
-- with the argMax(...) AS owner/status aliases above in one SELECT makes
-- ClickHouse resolve `owner`/`status` here to those aggregate aliases
-- instead of the raw per-event columns, nesting an aggregate inside
-- another (ILLEGAL_AGGREGATION).
signals as (

    -- toNullable(received_at): minIf on a non-Nullable column returns that
    -- type's default (epoch) rather than NULL when zero rows match — an
    -- occurrence with no progress/terminal transition yet must come out
    -- NULL here, not 1970-01-01, or it reads as acknowledged/closed.
    select
        tenant_id,
        source,
        external_id,
        minIf(toNullable(received_at), owner != '' or status not in ('open', 'unknown')) as first_progress_at,
        minIf(toNullable(received_at), status in ('resolved', 'closed', 'canceled'))     as first_terminal_at
    from events
    group by tenant_id, source, external_id

),

-- Joins chained one at a time rather than three in a single FROM clause —
-- CREATE TABLE ... ORDER BY (tenant_id, source, external_id) EMPTY AS
-- <select> fails to resolve those columns (UNKNOWN_IDENTIFIER) once a
-- third table joined on the exact same tuple enters the same FROM clause,
-- on ClickHouse 24.3. Two-way joins, chained, do not hit it.
with_signals as (

    select
        l.*,
        s.first_progress_at,
        s.first_terminal_at
    from latest l
    left join signals s
        on  s.tenant_id = l.tenant_id
        and s.source = l.source
        and s.external_id = l.external_id

),

with_changes as (

    select
        w.*,
        coalesce(sc.severity_changes, 0) as severity_changes
    from with_signals w
    left join severity_change_counts sc
        on  sc.tenant_id = w.tenant_id
        and sc.source = w.source
        and sc.external_id = w.external_id

)

select
    w.tenant_id,
    w.source,
    w.external_id,
    w.severity,
    w.status,
    w.entity_id,
    w.title,
    w.description,
    w.owner,
    w.reported_by,
    w.parent_id,
    w.resolution_code,
    w.resolution_summary,
    w.labels,
    w.source_url,
    w.opened_at,
    coalesce(w.origin_acknowledged_at, w.first_progress_at) as acknowledged_at,
    w.resolved_at,
    coalesce(w.origin_closed_at, w.first_terminal_at)       as closed_at,
    dateDiff(
        'second', w.opened_at, coalesce(w.resolved_at, w.origin_closed_at, w.first_terminal_at)
    )                                                        as duration_seconds,
    d.deadline_seconds,
    w.opened_at + toIntervalSecond(d.deadline_seconds)      as due_at,
    dateDiff(
        'second',
        w.opened_at,
        coalesce(w.resolved_at, w.origin_closed_at, w.first_terminal_at, {{ cutoff }})
    ) / nullIf(d.deadline_seconds, 0)                       as consumed_ratio,
    (
        dateDiff(
            'second',
            w.opened_at,
            coalesce(w.resolved_at, w.origin_closed_at, w.first_terminal_at, {{ cutoff }})
        ) / nullIf(d.deadline_seconds, 0)
    ) >= 1.0                                                as has_breached,
    w.severity in (1, 2, 3)
        and w.parent_id = ''
        and w.resolution_code != 'no_intervention'          as is_eligible,
    w.severity_changes
from with_changes w
left join {{ ref('tenant_deadlines') }} d
    on  d.tenant_id = w.tenant_id
    and d.severity = w.severity

{% endmacro %}
