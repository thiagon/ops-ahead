from prometheus_client import Counter, start_http_server

events_consumed = Counter(
    "burst_detector_events_consumed_total",
    "Total incident events consumed from Kafka",
)

alerts_published = Counter(
    "burst_detector_alerts_published_total",
    "Total alerts published to alerts.burst",
    ["alert_type", "window"],
)


def start(port: int) -> None:
    start_http_server(port)
