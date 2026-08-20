from prometheus_client import Counter, Gauge, Histogram, start_http_server

events_consumed = Counter(
    "ingest_events_consumed_total",
    "Total raw envelopes consumed from Kafka",
    ["source", "intake"],
)

milestones_consumed = Counter(
    "ingest_milestones_consumed_total",
    "Total deadline milestones consumed from Kafka into bronze_deadline_milestone",
    ["kind"],
)

translation_failures = Counter(
    "ingest_translation_failures_total",
    "Raw envelopes with no adapter or dictionary — kept in the lake, skipped for bronze",
    ["source", "intake"],
)

batch_size = Histogram(
    "ingest_batch_size",
    "Number of events per batch flush",
    buckets=[10, 50, 100, 250, 500, 1000],
)

batch_latency = Histogram(
    "ingest_batch_flush_seconds",
    "Time to flush one batch (ClickHouse + MinIO)",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)

consumer_lag = Gauge(
    "ingest_consumer_lag_messages",
    "Estimated consumer lag (messages behind latest offset)",
    ["partition"],
)


def start(port: int) -> None:
    start_http_server(port)
