{{ config(materialized='view') }}

select
    event_id,
    source,
    received_at,
    opened_at,
    severity,
    entity_id,
    status,

    -- Origin fields extracted from payload_raw, already normalized by the gateway
    JSONExtractString(payload_raw, 'ticket_number')                                 as ticket_number,
    JSONExtractString(payload_raw, 'priority_label')                                as priority_label,
    JSONExtractString(payload_raw, 'product')                                       as product,
    JSONExtractString(payload_raw, 'category')                                      as category,
    JSONExtractString(payload_raw, 'subcategory')                                   as subcategory,
    JSONExtractString(payload_raw, 'assignment_group')                              as assignment_group,
    JSONExtractInt(payload_raw, 'opened_hour')                                      as opened_hour,
    JSONExtractString(payload_raw, 'opened_weekday')                                as opened_weekday,
    JSONExtractInt(payload_raw, 'opened_week_of_year')                              as opened_week_of_year,
    JSONExtractInt(payload_raw, 'opened_month')                                     as opened_month,
    parseDateTimeBestEffortOrNull(JSONExtractString(payload_raw, 'resolved_at'))    as resolved_at,
    parseDateTimeBestEffortOrNull(JSONExtractString(payload_raw, 'closed_at'))      as closed_at,
    JSONExtractInt(payload_raw, 'duration_seconds')                                 as duration_seconds,
    JSONExtractString(payload_raw, 'close_code')                                    as close_code,
    JSONExtractString(payload_raw, 'resolution')                                    as resolution,
    opened_by,
    JSONExtractString(payload_raw, 'parent_incident')                               as parent_incident,
    JSONExtractInt(payload_raw, 'has_parent_incident')                              as has_parent_incident,
    JSONExtractString(payload_raw, 'short_description')                             as short_description,
    JSONExtractInt(payload_raw, 'counted_in_kpi')                                   as counted_in_kpi,
    JSONExtractInt(payload_raw, 'kpi_breached')                                     as kpi_breached

from {{ source('ingest', 'incidents_received') }}
