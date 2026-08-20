from __future__ import annotations

from redis_snapshot import publish_snapshot, read_signal_counts
from settings import Settings


class FakeClient:
    """In-memory stand-in for clickhouse_driver.Client — no real ClickHouse."""

    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def execute(self, query: str, params: dict | None = None):
        return self._rows


class FakeRedis:
    """In-memory stand-in for redis.Redis — no real Redis."""

    def __init__(self) -> None:
        self.store: dict[str, tuple] = {}

    def set(self, key: str, value, ex: int | None = None) -> None:
        self.store[key] = (value, ex)


def test_read_signal_counts_returns_one_row_per_entity():
    client = FakeClient([("host-a", 12), ("host-b", 3)])

    counts = read_signal_counts(client)

    assert counts == {"host-a": 12, "host-b": 3}


def test_publish_snapshot_writes_each_entity_with_a_ttl():
    client = FakeClient([("host-a", 12), ("host-b", 3)])
    redis_client = FakeRedis()

    published = publish_snapshot(Settings(), client=client, redis_client=redis_client)

    assert published == 2
    assert redis_client.store["monitor:signal_count:host-a"] == (12, 900)
    assert redis_client.store["monitor:signal_count:host-b"] == (3, 900)


def test_publish_snapshot_returns_zero_when_no_entities_have_signals():
    client = FakeClient([])
    redis_client = FakeRedis()

    published = publish_snapshot(Settings(), client=client, redis_client=redis_client)

    assert published == 0
    assert redis_client.store == {}
