CREATE TABLE IF NOT EXISTS bronze_deadline_milestone
(
    event_id           UUID,
    tenant_id           LowCardinality(String),
    source              LowCardinality(String),
    external_id          String,
    entity_id             String,
    kind                  LowCardinality(String),
    severity              UInt8,
    opened_at             DateTime64(3, 'UTC'),
    acknowledged_at       Nullable(DateTime64(3, 'UTC')),
    due_at                DateTime64(3, 'UTC'),
    deadline_seconds      UInt32,
    consumed_ratio        Float64,
    occurred_at           DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, source, external_id, occurred_at)
SETTINGS index_granularity = 8192;
