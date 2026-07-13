from prometheus_client import Counter, Gauge, Histogram, start_http_server

events_consumed = Counter(
    "ingest_events_consumed_total",
    "Total events consumed from Kafka",
    ["source"],
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
