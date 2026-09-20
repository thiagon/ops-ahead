{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, date, category, product, entity_id, severity)',
        partition_by='toYYYYMM(date)'
    )
}}

-- Category × product × entity × severity, no dimension collapsed —
-- clustering/recurring-cause input, not a screen product. `breached` is
-- safe here because severity is already part of the grain, unlike
-- gold_alert_daily_features where it would blend targets across severities.
select
    tenant_id,
    toDate(opened_at)         as date,
    labels['category']        as category,
    labels['product']         as product,
    entity_id,
    severity,
    count()                   as incident_count,
    countIf(has_breached)     as breached,
    avg(duration_seconds)     as avg_duration_seconds
from {{ ref('silver_alert') }}
group by tenant_id, date, category, product, entity_id, severity
