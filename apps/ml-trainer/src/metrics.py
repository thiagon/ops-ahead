from prometheus_client import Counter, start_http_server

messages_consumed = Counter(
    "ml_trainer_messages_consumed_total",
    "Total trigger.ml messages consumed",
    ["analysis"],
)


def start(port: int) -> None:
    start_http_server(port)
