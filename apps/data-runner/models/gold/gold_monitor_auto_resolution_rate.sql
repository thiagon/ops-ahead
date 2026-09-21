{{
    config(
        materialized='table',
        engine='MergeTree()',
        order_by='(tenant_id, entity_id)'
    )
}}

-- Fraction of conditions on an entity that cleared on their own (monitor has
-- no owner/acknowledgment — "auto" here means the condition transitioned to
-- cleared, not that a human intervened, which does not exist in this chain).
select
    tenant_id,
    entity_id,
    count()                                                            as condition_count,
    countIf(condition = 'cleared')                                     as cleared_count,
    countIf(condition = 'cleared') / count()                           as auto_resolution_rate
from {{ ref('silver_monitor') }}
group by tenant_id, entity_id
