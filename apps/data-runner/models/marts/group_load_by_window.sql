{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(assignment_group, window_start)',
        partition_by='toYYYYMM(window_start)'
    )
}}

-- Incidents opened per assignment_group per hourly bucket — the breach model's
-- "carga do grupo designado" feature. Online serving reads a Redis snapshot of
-- this same aggregate (cache-aside, refreshed on a short TTL) rather than
-- hitting ClickHouse on every prediction request.
select
    assignment_group,
    toStartOfInterval(opened_at, interval 1 hour) as window_start,
    count()                                       as incidents_opened
from {{ ref('stg_incidents') }}
group by assignment_group, window_start
