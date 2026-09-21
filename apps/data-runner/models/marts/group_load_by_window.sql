{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, owner, snapshot_at)',
        partition_by='toYYYYMM(snapshot_at)'
    )
}}

-- Current load per owner group — occurrences alive right now, not a
-- historical count of what opened in some past hour. Refreshed on every
-- dbt run, same as silver_alert_open it reads from; snapshot_at timestamps
-- which refresh produced the row.
select
    tenant_id,
    owner,
    now64(3)    as snapshot_at,
    count()     as incidents_open
from {{ ref('silver_alert_open') }}
group by tenant_id, owner
