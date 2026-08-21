{{
    config(
        materialized='view'
    )
}}

-- Every incident open at a given milestone's occurred_at.
with incident_lifecycle as (

    select
        tenant_id,
        source,
        external_id,
        any(opened_at)                                                                as opened_at,
        minIf(toNullable(received_at), status in ('resolved', 'closed', 'canceled'))   as first_closing_received_at
    from {{ source('ingest', 'bronze_alert') }}
    group by tenant_id, source, external_id

),

milestones as (

    select
        event_id as milestone_id,
        tenant_id,
        source,
        external_id,
        occurred_at
    from {{ source('ingest', 'bronze_deadline_milestone') }}

)

-- Every column aliased: without one ClickHouse names the output column
-- after the qualified expression (`l.tenant_id`), so a consumer selecting
-- `c.tenant_id` from this view gets UNKNOWN_IDENTIFIER.
select
    m.milestone_id as milestone_id,
    m.occurred_at  as occurred_at,
    l.tenant_id    as tenant_id,
    l.source       as source,
    l.external_id  as external_id
-- cross join, not inner join: there's no equality key between a milestone
-- and "some other incident open at the same time" — every condition here
-- compares columns across both sides, which ClickHouse's join planner
-- rejects in ON (DB::Exception, code 403, "join expression contains column
-- from left and right table") once there's no equality condition to hash on.
from milestones m
cross join incident_lifecycle l
where l.opened_at <= m.occurred_at
    and (l.first_closing_received_at is null or l.first_closing_received_at > m.occurred_at)
    and not (l.tenant_id = m.tenant_id and l.source = m.source and l.external_id = m.external_id)
