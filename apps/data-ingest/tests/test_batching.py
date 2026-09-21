from types import SimpleNamespace
from typing import NamedTuple

import pytest
from faststream import AckPolicy

from batching import RewindFetchedBatch, batch_subscriber_kwargs, rewind_fetched_batch
from settings import Settings


class _Record(NamedTuple):
    topic: str
    partition: int
    offset: int


class _Consumer:
    def __init__(self) -> None:
        self.seeks: list[tuple[str, int, int]] = []

    def seek(self, partition, offset: int) -> None:
        self.seeks.append((partition.topic, partition.partition, offset))


def test_batch_subscriber_uses_settings_as_the_fetch():
    settings = Settings(
        batch_max_size=100, batch_max_seconds=5, kafka_group_id="events-ingest"
    )

    assert batch_subscriber_kwargs(settings) == {
        "group_id": "events-ingest",
        "batch": True,
        "max_records": 100,
        "batch_timeout_ms": 5000,
        "ack_policy": AckPolicy.MANUAL,
    }


def test_rewind_seeks_each_partition_to_its_earliest_offset():
    consumer = _Consumer()
    handler = SimpleNamespace(consumer=consumer)
    fetched = (
        _Record("events.raw.alert", 0, 8),
        _Record("events.raw.alert", 1, 4),
        _Record("events.raw.alert", 0, 5),
        _Record("events.raw.alert", 1, 9),
    )

    rewind_fetched_batch(handler, fetched)

    assert sorted(consumer.seeks) == [
        ("events.raw.alert", 0, 5),
        ("events.raw.alert", 1, 4),
    ]

    consumer.seeks.clear()
    rewind_fetched_batch(handler, list(fetched))
    assert sorted(consumer.seeks) == [
        ("events.raw.alert", 0, 5),
        ("events.raw.alert", 1, 4),
    ]


def test_rewind_ignores_a_single_record():
    consumer = _Consumer()
    handler = SimpleNamespace(consumer=consumer)

    rewind_fetched_batch(handler, _Record("events.raw.alert", 0, 3))

    assert consumer.seeks == []


def test_rewind_does_nothing_without_a_consumer():
    rewind_fetched_batch(SimpleNamespace(consumer=None), (_Record("t", 0, 1),))
    rewind_fetched_batch(None, (_Record("t", 0, 1),))


@pytest.mark.asyncio
async def test_middleware_rewinds_only_when_the_handler_fails():
    consumer = _Consumer()
    fetched = (_Record("events.raw.alert", 0, 2), _Record("events.raw.alert", 2, 7))
    middleware = RewindFetchedBatch(
        fetched,
        context=SimpleNamespace(
            get=lambda key, default=None: SimpleNamespace(consumer=consumer)
        ),
    )

    await middleware.after_processed(None, None, None)
    assert consumer.seeks == []

    await middleware.after_processed(
        RuntimeError, RuntimeError("clickhouse down"), None
    )
    assert consumer.seeks == [
        ("events.raw.alert", 0, 2),
        ("events.raw.alert", 2, 7),
    ]
