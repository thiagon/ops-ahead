DROP TABLE IF EXISTS tenant_kpi_targets;

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
