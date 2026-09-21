-- The projection table follows gold_alert_kpi_achievement: the band is the
-- severities themselves, never a label.
--
-- Recreated rather than ALTERed: severities also replaces kpi_group in
-- ORDER BY, and ClickHouse does not allow modifying a column that is part of
-- the sorting key. Dropping loses past projections, which are rewritten by
-- the next run — the table holds the latest projection, not history.

DROP TABLE IF EXISTS gold_kpi_projection;

CREATE TABLE IF NOT EXISTS gold_kpi_projection
(
    tenant_id            LowCardinality(String),
    as_of_date           Date,
    severities           Array(UInt8),
    median_breaches_ytd  Float64,
    ci80_lower           Float64,
    ci80_upper           Float64,
    p_within_target      Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (tenant_id, severities, as_of_date)
SETTINGS index_granularity = 8192;
