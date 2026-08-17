from prometheus_client import Counter, start_http_server

messages_consumed = Counter(
    "data_runner_messages_consumed_total",
    "Total trigger.data messages consumed",
    ["analysis"],
)


def start(port: int) -> None:
    start_http_server(port)
