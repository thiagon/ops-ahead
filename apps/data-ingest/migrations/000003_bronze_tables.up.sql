CREATE TABLE IF NOT EXISTS bronze_alert
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
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (tenant_id, source, external_id, received_at)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS bronze_monitor
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
ENGINE = MergeTree
PARTITION BY toYYYYMM(received_at)
ORDER BY (tenant_id, source, external_id, received_at)
SETTINGS index_granularity = 8192;
