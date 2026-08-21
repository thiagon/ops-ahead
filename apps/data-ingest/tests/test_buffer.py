import asyncio
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from buffer import BatchBuffer
from models import EventEnvelope


def _envelope() -> EventEnvelope:
    return EventEnvelope.model_validate(
        {
            "event_id": str(uuid4()),
            "tenant_id": "locaweb",
            "source": "itsm",
            "intake": "alert",
            "version": "v1",
            "received_at": "2024-01-15T10:00:00+00:00",
            "payload": "{}",
        }
    )


@pytest.mark.asyncio
async def test_flush_on_max_size():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=3, max_seconds=60)

    for _ in range(3):
        await buf.add(_envelope())

    flush.assert_awaited_once()
    batch = flush.call_args[0][0]
    assert len(batch) == 3


@pytest.mark.asyncio
async def test_no_flush_below_max_size():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=10, max_seconds=60)

    for _ in range(5):
        await buf.add(_envelope())

    flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_flush_on_time_deadline():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=1000, max_seconds=0.01)

    await buf.add(_envelope())
    await asyncio.sleep(0.05)
    await buf.tick()

    flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_drain_flushes_remainder():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=1000, max_seconds=60)

    for _ in range(4):
        await buf.add(_envelope())

    await buf.drain()
    flush.assert_awaited_once()
    assert len(flush.call_args[0][0]) == 4


@pytest.mark.asyncio
async def test_items_cleared_after_flush():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=2, max_seconds=60)

    await buf.add(_envelope())
    await buf.add(_envelope())  # triggers flush
    await buf.add(_envelope())
    await buf.drain()

    assert flush.await_count == 2
    # second flush only has 1 item
    assert len(flush.call_args_list[1][0][0]) == 1
