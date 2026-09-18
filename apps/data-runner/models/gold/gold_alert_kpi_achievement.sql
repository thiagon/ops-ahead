{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, kpi_group, year, month)',
        partition_by='toYYYYMM(month)'
    )
}}

-- Cumulative KPI achievement against the annual band, as configured per tenant.
-- P1 and P2 share one band (kpi_group = 'p1_p2' — the kickoff never scores P1
-- alone, always "P1+P2"); P3 has its own. breached_ytd resets every year.
with monthly as (

    select
        tenant_id,
        toYear(opened_at)          as year,
        toStartOfMonth(opened_at)  as month,
        -- '' instead of null: the WHERE below already restricts to severity
        -- in (1,2,3), so this branch never actually fires — but a null
        -- branch types the column Nullable, which MergeTree rejects in
        -- order_by (allow_nullable_key is off).
        multiIf(severity in (1, 2), 'p1_p2', severity = 3, 'p3', '') as kpi_group,
        countIf(is_eligible and has_breached)                          as breached_in_month
    from {{ ref('silver_alert') }}
    where severity in (1, 2, 3) and closed_at is not null
    group by tenant_id, year, month, kpi_group

),

cumulative as (

    select
        tenant_id,
        year,
        month,
        kpi_group,
        breached_in_month,
        sum(breached_in_month) over (
            partition by tenant_id, kpi_group, year
            order by month
            rows between unbounded preceding and current row
        ) as breached_ytd
    from monthly

)

select
    c.tenant_id,
    c.year,
    c.month,
    c.kpi_group,
    c.breached_in_month,
    c.breached_ytd,
    t.achievement_pct
from cumulative c
inner join {{ source('config', 'tenant_kpi_targets') }} t
    on  t.tenant_id = c.tenant_id
    and t.kpi_group = c.kpi_group
where t.max_breaches >= c.breached_ytd
order by c.tenant_id, c.year, c.month, c.kpi_group, t.max_breaches asc
limit 1 by c.tenant_id, c.year, c.month, c.kpi_group
