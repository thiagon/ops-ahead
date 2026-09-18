from prometheus_client import Counter, start_http_server

events_consumed = Counter(
    "notify_slack_events_consumed_total",
    "Total incident-alert events consumed from Kafka",
)

notifications_sent = Counter(
    "notify_slack_notifications_sent_total",
    "Total Slack notifications sent",
)

notifications_failed = Counter(
    "notify_slack_notifications_failed_total",
    "Total Slack notifications that failed to send",
)


def start(port: int) -> None:
    start_http_server(port)
