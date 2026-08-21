{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(date, category, product)',
        partition_by='toYYYYMM(date)'
    )
}}

-- Daily volume trend by category/product — `labels` (free-form Map) is
-- where these survive translation (apps/data-ingest/src/sources/itsm.py);
-- missing key reads as '' by ClickHouse Map subscript default, kept
-- visible as its own category rather than filtered out.
select
    toDate(opened_at)         as date,
    labels['category']        as category,
    labels['product']         as product,
    count()                   as total_incidents,
    countIf(severity = 1)     as p1_count,
    countIf(severity = 2)     as p2_count,
    countIf(severity = 3)     as p3_count,
    countIf(severity = 4)     as p4_count,
    countIf(severity = 5)     as p5_count,
    avg(duration_seconds)     as avg_duration_seconds
from {{ ref('silver_alert') }}
group by date, category, product
