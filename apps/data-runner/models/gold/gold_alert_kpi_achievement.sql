{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, severities, year, month)',
        partition_by='toYYYYMM(month)'
    )
}}

-- Cumulative KPI achievement against the annual band each tenant configured.
-- The band is whatever `tenant_kpi_targets.severities` lists, so a tenant that
-- measures [1,2,4] gets that band without any severity being named here.
-- breached_ytd resets every year.
-- FINAL is required, not cosmetic: tenant_kpi_targets is a
-- ReplacingMergeTree and every republication of a tenant's targets leaves the
-- superseded rows readable until a merge collapses them. Joining without it
-- counts the same band once per surviving version.
with targets as (

    select tenant_id, severities, max_breaches, achievement_pct
    from {{ source('config', 'tenant_kpi_targets') }} final

),

bands as (

    select
        tenant_id,
        severities,
        arrayJoin(severities) as severity
    from targets

),

monthly as (

    select
        a.tenant_id                                          as tenant_id,
        b.severities                                         as severities,
        toYear(a.opened_at)                                  as year,
        toStartOfMonth(a.opened_at)                          as month,
        countIf(a.is_eligible and a.has_breached)            as breached_in_month
    from {{ ref('silver_alert') }} a
    inner join bands b
        on  b.tenant_id = a.tenant_id
        and b.severity  = a.severity
    where a.closed_at is not null
    group by tenant_id, severities, year, month

),

cumulative as (

    select
        tenant_id,
        severities,
        year,
        month,
        breached_in_month,
        sum(breached_in_month) over (
            partition by tenant_id, severities, year
            order by month
            rows between unbounded preceding and current row
        ) as breached_ytd
    from monthly

)

select
    c.tenant_id,
    c.year,
    c.month,
    c.severities,
    c.breached_in_month,
    c.breached_ytd,
    t.achievement_pct
from cumulative c
inner join targets t
    on  t.tenant_id  = c.tenant_id
    and t.severities = c.severities
where t.max_breaches >= c.breached_ytd
order by c.tenant_id, c.year, c.month, c.severities, t.max_breaches asc
limit 1 by c.tenant_id, c.year, c.month, c.severities
