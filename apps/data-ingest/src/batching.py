"""One Kafka fetch is one write. The handler commits the offset only after
that write returns, so the fetch has to be the batch — waiting inside the
handler never sees the next record.

A fetch can span several partitions. On failure each of them is seeked back
to the first offset in that fetch; seeking only the first partition would
skip the others.
"""

from typing import Any

from aiokafka import TopicPartition
from faststream import AckPolicy, BaseMiddleware

from settings import Settings


def batch_subscriber_kwargs(settings: Settings) -> dict[str, Any]:
    return {
        "group_id": settings.kafka_group_id,
        "batch": True,
        "max_records": settings.batch_max_size,
        "batch_timeout_ms": round(settings.batch_max_seconds * 1000),
        "ack_policy": AckPolicy.MANUAL,
    }


def rewind_fetched_batch(handler: Any, message: object) -> None:
    records = _fetched_records(message)
    if records is None or handler is None:
        return
    consumer = getattr(handler, "consumer", None)
    if consumer is None:
        return

    earliest: dict[tuple[str, int], int] = {}
    for record in records:
        key = (record.topic, record.partition)
        current = earliest.get(key)
        if current is None or record.offset < current:
            earliest[key] = record.offset
    for (topic, partition), offset in earliest.items():
        consumer.seek(TopicPartition(topic, partition), offset)


def _fetched_records(message: object) -> tuple[Any, ...] | list[Any] | None:
    # A single ConsumerRecord is itself a tuple, but of fields, not records.
    if not isinstance(message, (tuple, list)) or not message:
        return None
    first = message[0]
    if not all(hasattr(first, attr) for attr in ("topic", "partition", "offset")):
        return None
    return message


class RewindFetchedBatch(BaseMiddleware):
    async def after_processed(
        self,
        exc_type: type[BaseException] | None = None,
        exc_val: BaseException | None = None,
        exc_tb: Any = None,
    ) -> bool:
        if exc_type is not None:
            rewind_fetched_batch(self.context.get("handler_"), self.msg)
        return False
