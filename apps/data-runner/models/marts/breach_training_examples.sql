{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, occurred_at)',
        partition_by='toYYYYMM(occurred_at)'
    )
}}

-- One row per deadlines.milestone message — the (incidente × marco) training
-- unit (see spec.md, "Treino revisto"). Everything prefixed as-of-state is
-- reconstructed from bronze_alert filtered to received_at <= occurred_at, the
-- same technique as macros/silver_alert_as_of.sql but keyed per milestone
-- instead of "now", so no feature here can see anything the tracker did not
-- already know when it emitted this milestone. `has_breached`/
-- `final_consumed_ratio`/`final_duration_seconds` are the only exception —
-- they come from silver_alert's current state on purpose (the eventual
-- outcome is the label, and the exclusion rules in ml-trainer need the
-- incident's final numbers, not what was known at this particular marco).
with milestones as (

    select
        event_id       as milestone_id,
        tenant_id,
        source,
        external_id,
        entity_id,
        kind,
        severity       as severity_at_milestone,
        opened_at,
        acknowledged_at as acknowledged_at_at_milestone,
        due_at,
        deadline_seconds,
        consumed_ratio as consumed_ratio_at_milestone,
        occurred_at
    from {{ source('ingest', 'bronze_deadline_milestone') }}

),

-- This incident's own event history up to each of its milestones — bounded
-- by (milestones × that one incident's events), not the whole population.
own_events as (

    select
        m.milestone_id,
        e.received_at,
        e.owner,
        e.reported_by,
        e.parent_id,
        e.resolution_code,
        e.status,
        e.severity,
        lagInFrame(e.severity) over (
            partition by m.milestone_id order by e.received_at
        )                                                                  as prev_severity,
        row_number() over (
            partition by m.milestone_id order by e.received_at
        )                                                                  as rn
    from milestones m
    inner join {{ source('ingest', 'bronze_alert') }} e
        on  e.tenant_id = m.tenant_id
        and e.source = m.source
        and e.external_id = m.external_id
        and e.received_at <= m.occurred_at

),

own_asof_state as (

    select
        milestone_id,
        argMax(owner, received_at)              as owner,
        argMax(reported_by, received_at)        as reported_by,
        argMax(parent_id, received_at)          as parent_id,
        argMax(resolution_code, received_at)    as resolution_code,
        argMax(status, received_at)             as status,
        countIf(rn > 1 and prev_severity != severity) as severity_changes
    from own_events
    group by milestone_id

),

-- Fixed per incident, independent of any cutoff — once a closing event has
-- happened it stays happened. This is what makes "open at T" a lookup
-- instead of a per-T reconstruction.
incident_lifecycle as (

    select
        tenant_id,
        source,
        external_id,
        any(opened_at)                                                                as opened_at,
        minIf(toNullable(received_at), status in ('resolved', 'closed', 'canceled'))   as first_closing_received_at
    from {{ source('ingest', 'bronze_alert') }}
    group by tenant_id, source, external_id

),

-- Every OTHER incident open at this milestone's occurred_at — "opened_at <=
-- occurred_at and not yet closed at that instant" needs no per-T
-- reconstruction (see incident_lifecycle above), so this join stays cheap
-- relative to a full as-of pass over the population.
candidate_open as (

    select
        m.milestone_id,
        m.occurred_at,
        l.tenant_id,
        l.source,
        l.external_id
    from milestones m
    inner join incident_lifecycle l
        on  l.opened_at <= m.occurred_at
        and (l.first_closing_received_at is null or l.first_closing_received_at > m.occurred_at)
        and not (l.tenant_id = m.tenant_id and l.source = m.source and l.external_id = m.external_id)

),

-- Owner-at-T for every candidate — the same as-of technique as own_events,
-- just over the wider candidate set instead of one incident's own history.
candidate_owner as (

    select
        c.milestone_id,
        c.tenant_id,
        c.source,
        c.external_id,
        argMax(e.owner, e.received_at) as owner
    from candidate_open c
    inner join {{ source('ingest', 'bronze_alert') }} e
        on  e.tenant_id = c.tenant_id
        and e.source = c.source
        and e.external_id = c.external_id
        and e.received_at <= c.occurred_at
    group by c.milestone_id, c.tenant_id, c.source, c.external_id

),

group_load as (

    select
        milestone_id,
        owner,
        count() as open_count
    from candidate_owner
    group by milestone_id, owner

),

-- When each incident's no_intervention resolution became knowable — the
-- first event that carries it, a fixed fact once it happens, same trick as
-- incident_lifecycle above but keyed by entity instead of by the milestone's
-- own incident. incidents_by_ic (Fase 5) reads this from silver_alert's
-- current state instead, which is exactly the leak this table exists to
-- avoid: a no_intervention verdict is only knowable once the incident
-- closes, not at opened_at.
no_intervention_events as (

    select
        tenant_id,
        source,
        external_id,
        entity_id,
        minIf(toNullable(received_at), resolution_code = 'no_intervention') as no_intervention_known_at
    from {{ source('ingest', 'bronze_alert') }}
    where entity_id is not null and entity_id != ''
    group by tenant_id, source, external_id, entity_id
    having no_intervention_known_at is not null

),

no_intervention_nearby as (

    select
        m.milestone_id,
        m.occurred_at,
        n.no_intervention_known_at
    from milestones m
    inner join no_intervention_events n
        on  n.entity_id = m.entity_id
        and n.no_intervention_known_at <= m.occurred_at
        and not (n.tenant_id = m.tenant_id and n.source = m.source and n.external_id = m.external_id)
    where m.entity_id is not null and m.entity_id != ''

),

no_intervention_counts as (

    select
        milestone_id,
        countIf(no_intervention_known_at >= occurred_at - toIntervalHour(1))  as no_intervention_count_1h,
        countIf(no_intervention_known_at >= occurred_at - toIntervalHour(6))  as no_intervention_count_6h,
        countIf(no_intervention_known_at >= occurred_at - toIntervalHour(24)) as no_intervention_precursor_length
    from no_intervention_nearby
    group by milestone_id

),

with_state as (

    select
        m.*,
        a.owner,
        a.reported_by,
        a.parent_id,
        a.resolution_code,
        a.status,
        a.severity_changes,
        m.severity_at_milestone in (1, 2, 3)
            and coalesce(a.parent_id, '') = ''
            and coalesce(a.resolution_code, '') != 'no_intervention'    as is_eligible
    from milestones m
    left join own_asof_state a
        on a.milestone_id = m.milestone_id

),

with_load as (

    select
        w.*,
        coalesce(g.open_count, 0) as group_load
    from with_state w
    left join group_load g
        on  g.milestone_id = w.milestone_id
        and g.owner = w.owner

),

with_no_intervention as (

    select
        w.*,
        coalesce(n.no_intervention_count_1h, 0)        as no_intervention_count_1h,
        coalesce(n.no_intervention_count_6h, 0)        as no_intervention_count_6h,
        coalesce(n.no_intervention_precursor_length, 0) as no_intervention_precursor_length
    from with_load w
    left join no_intervention_counts n
        on n.milestone_id = w.milestone_id

)

select
    w.*,
    sa.has_breached           as has_breached,
    sa.consumed_ratio         as final_consumed_ratio,
    sa.duration_seconds       as final_duration_seconds
from with_no_intervention w
left join {{ ref('silver_alert') }} sa
    on  sa.tenant_id = w.tenant_id
    and sa.source = w.source
    and sa.external_id = w.external_id
