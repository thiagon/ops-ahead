{{ config(materialized='view') }}

-- One row per event, already in the domain vocabulary — bronze_alert is
-- translated, not raw, so nothing here reads a payload column any more
-- (domain/ubiquitous-language.md#incident). Downstream marts that depend on
-- fields bronze_alert does not carry (duration, opened_hour/weekday/month,
-- counted_in_kpi, kpi_breached, priority_label) are rebuilt per-chain in
-- later phases of incident-flow_20260819 — those derivations move to silver,
-- computed from opened_at/resolved_at/closed_at, never received again.
select
    event_id,
    tenant_id,
    source,
    version,
    dictionary_version,
    received_at,
    external_id,
    opened_at,
    acknowledged_at,
    resolved_at,
    closed_at,
    severity,
    status,
    entity_id,
    title,
    description,
    owner,
    reported_by,
    parent_id,
    resolution_code,
    resolution_summary,
    labels,
    source_url

from {{ source('ingest', 'bronze_alert') }}
