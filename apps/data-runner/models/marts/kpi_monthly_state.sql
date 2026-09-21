{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, month, severity, source)',
        partition_by='toYYYYMM(month)'
    )
}}

-- Monthly KPI state per severity × source — realized (closed occurrences)
-- plus what's at risk right now (open, eligible, past 75% of its deadline).
-- Only the current month has an at-risk bucket; historical months only ever
-- had closed occurrences to begin with.
-- Every severity is carried, not only 1-3: a tenant configures which
-- severities form a KPI band, and kpi_projection reads the eligibility of
-- whichever ones that band lists.
with realized as (

    select
        tenant_id,
        toStartOfMonth(opened_at)                                       as month,
        severity,
        source,
        count()                                                         as total,
        countIf(is_eligible)                                            as in_kpi,
        countIf(has_breached)                                           as breached,
        countIf(is_eligible and not has_breached)                       as compliant,
        countIf(has_breached) / nullIf(countIf(is_eligible), 0)         as breach_rate,
        avg(duration_seconds)                                           as avg_duration_seconds,
        quantile(0.5)(duration_seconds)                                 as median_duration_seconds,
        quantile(0.95)(duration_seconds)                                as p95_duration_seconds
    from {{ ref('silver_alert') }}
    where closed_at is not null
    group by tenant_id, month, severity, source

),

at_risk as (

    select
        tenant_id,
        toStartOfMonth(opened_at)                          as month,
        severity,
        source,
        countIf(is_eligible and consumed_ratio >= 0.75)    as open_at_risk_count
    from {{ ref('silver_alert_open') }}
    group by tenant_id, month, severity, source

)

select
    r.tenant_id,
    r.month,
    r.severity,
    r.source,
    r.total,
    r.in_kpi,
    r.breached,
    r.compliant,
    r.breach_rate,
    r.avg_duration_seconds,
    r.median_duration_seconds,
    r.p95_duration_seconds,
    coalesce(a.open_at_risk_count, 0) as open_at_risk_count
from realized r
left join at_risk a
    on  a.tenant_id = r.tenant_id
    and a.month = r.month
    and a.severity = r.severity
    and a.source = r.source
