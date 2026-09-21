DROP TABLE IF EXISTS gold_kpi_projection;

CREATE TABLE IF NOT EXISTS gold_kpi_projection
(
    tenant_id            LowCardinality(String),
    as_of_date           Date,
    kpi_group            LowCardinality(String),
    median_breaches_ytd  Float64,
    ci80_lower           Float64,
    ci80_upper           Float64,
    p_within_target      Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (tenant_id, kpi_group, as_of_date)
SETTINGS index_granularity = 8192;
