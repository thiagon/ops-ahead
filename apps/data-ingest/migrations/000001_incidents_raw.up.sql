CREATE TABLE IF NOT EXISTS incidents_raw
(
    event_id     UUID,
    source       LowCardinality(String),
    received_at  DateTime64(3, 'UTC'),
    opened_at    DateTime64(3, 'UTC'),
    severity     UInt8,
    entity_id    String,
    status       LowCardinality(String),
    payload_raw  String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(opened_at)
ORDER BY (entity_id, opened_at)
SETTINGS index_granularity = 8192;
