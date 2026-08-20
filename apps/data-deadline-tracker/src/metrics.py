from prometheus_client import Counter, Gauge, start_http_server

events_consumed = Counter(
    "deadline_tracker_events_consumed_total",
    "Total incident events consumed from events.alert",
)

milestones_published = Counter(
    "deadline_tracker_milestones_published_total",
    "Total milestones published to deadlines.milestone",
    ["kind", "severity"],
)

open_occurrences = Gauge(
    "deadline_tracker_open_occurrences",
    "Occurrences currently tracked as open",
)


def start(port: int) -> None:
    start_http_server(port)
