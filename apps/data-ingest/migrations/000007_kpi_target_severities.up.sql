-- kpi_group was the Locaweb dataset's p1_p2/p3 label petrified into an opaque
-- string: a tenant wanting P1 isolated, or P3+P4 combined, had no way to
-- express it. severities carries the band itself.
--
-- Recreated rather than ALTERed: severities also replaces kpi_group in
-- ORDER BY, and ClickHouse does not allow modifying a column that is part of
-- the sorting key.

DROP TABLE IF EXISTS tenant_kpi_targets;

CREATE TABLE IF NOT EXISTS tenant_kpi_targets
(
    tenant_id       LowCardinality(String),
    severities      Array(UInt8),
    max_breaches    UInt32,
    achievement_pct Float64,
    updated_at      DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, severities)
SETTINGS index_granularity = 8192;
