-- Bronze keeps one row per event (incident-flow_20260819/spec.md, "Bronze — o
-- evento traduzido"). The write path has several non-transactional effects and
-- acks last, so a retry re-runs inserts that already landed. ReplacingMergeTree
-- keyed through event_id makes that retry a no-op instead of a second row.
-- Occurrence-level deduplication is silver's, not this — it stays there.
--
-- The sort key keeps its old prefix so existing queries filter the same way.
-- event_id only makes the key unique per event.

CREATE TABLE IF NOT EXISTS bronze_alert_idempotent
(
    event_id           UUID,
    tenant_id           LowCardinality(String),
    source              LowCardinality(String),
    version              LowCardinality(String),
    dictionary_version   LowCardinality(String),
    received_at          DateTime64(3, 'UTC'),
    external_id          String,
    opened_at            DateTime64(3, 'UTC'),
    acknowledged_at       Nullable(DateTime64(3, 'UTC')),
    resolved_at           Nullable(DateTime64(3, 'UTC')),
    closed_at             Nullable(DateTime64(3, 'UTC')),
    severity              UInt8,
    status                LowCardinality(String),
    entity_id             String,
    title                 String,
    description           String,
    owner                 String,
    reported_by           LowCardinality(String),
    parent_id             String,
    resolution_code       LowCardinality(String),
    resolution_summary    String,
    labels                Map(String, String),
    source_url            String
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (tenant_id, source, external_id, received_at, event_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS bronze_monitor_idempotent
(
    event_id           UUID,
    tenant_id           LowCardinality(String),
    source              LowCardinality(String),
    version              LowCardinality(String),
    dictionary_version   LowCardinality(String),
    received_at          DateTime64(3, 'UTC'),
    external_id          String,
    started_at            DateTime64(3, 'UTC'),
    ended_at              Nullable(DateTime64(3, 'UTC')),
    severity              Nullable(UInt8),
    condition             LowCardinality(String),
    entity_id             String,
    title                 String,
    description           String,
    labels                Map(String, String),
    source_url            String
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (tenant_id, source, external_id, received_at, event_id)
SETTINGS index_granularity = 8192;

-- Carries the history forward with the rows a retry already duplicated
-- collapsed, so the table starts out holding the invariant it now enforces.
INSERT INTO bronze_alert_idempotent
SELECT * FROM bronze_alert ORDER BY event_id, received_at LIMIT 1 BY event_id;

INSERT INTO bronze_monitor_idempotent
SELECT * FROM bronze_monitor ORDER BY event_id, received_at LIMIT 1 BY event_id;

-- The previous tables are kept, not dropped: a migration that discards the
-- only copy of the landing data has no way back if the counts turn out wrong.
RENAME TABLE
    bronze_alert   TO bronze_alert_premerge,
    bronze_monitor TO bronze_monitor_premerge,
    bronze_alert_idempotent   TO bronze_alert,
    bronze_monitor_idempotent TO bronze_monitor;
