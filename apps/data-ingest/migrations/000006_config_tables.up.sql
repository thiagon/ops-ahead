-- The configuration the dbt models join against, materialized from the
-- compacted config.* topics. ReplacingMergeTree on the configuration's own key:
-- a correction publishes a new record for the same key and the latest one
-- wins, so these mirror the registry rather than accumulating history.

CREATE TABLE IF NOT EXISTS tenant_deadlines
(
    tenant_id        LowCardinality(String),
    severity         UInt8,
    deadline_seconds UInt32,
    updated_at       DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, severity)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS tenant_kpi_targets
(
    tenant_id       LowCardinality(String),
    kpi_group       LowCardinality(String),
    max_breaches    UInt32,
    achievement_pct Float64,
    updated_at      DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, kpi_group, achievement_pct)
SETTINGS index_granularity = 8192;
