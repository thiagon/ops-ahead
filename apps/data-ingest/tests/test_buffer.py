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

    await asyncio.gather(*[buf.add(_envelope()) for _ in range(3)])

    flush.assert_awaited_once()
    batch = flush.call_args[0][0]
    assert len(batch) == 3


@pytest.mark.asyncio
async def test_add_does_not_return_until_flushed():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=10, max_seconds=60)

    pending = asyncio.create_task(buf.add(_envelope()))
    await asyncio.sleep(0)
    flush.assert_not_awaited()
    assert not pending.done()

    await buf.drain()
    await pending
    flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_flush_on_time_deadline():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=1000, max_seconds=0.01)

    pending = asyncio.create_task(buf.add(_envelope()))
    await asyncio.sleep(0.05)
    await buf.tick()
    await pending

    flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_drain_flushes_remainder():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=1000, max_seconds=60)

    pending = [asyncio.create_task(buf.add(_envelope())) for _ in range(4)]
    await asyncio.sleep(0)
    await buf.drain()
    await asyncio.gather(*pending)

    flush.assert_awaited_once()
    assert len(flush.call_args[0][0]) == 4


@pytest.mark.asyncio
async def test_items_cleared_after_flush():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=2, max_seconds=60)

    first = asyncio.create_task(buf.add(_envelope()))
    await asyncio.gather(first, buf.add(_envelope()))
    leftover = asyncio.create_task(buf.add(_envelope()))
    await asyncio.sleep(0)
    await buf.drain()
    await leftover

    assert flush.await_count == 2
    assert len(flush.call_args_list[1][0][0]) == 1


@pytest.mark.asyncio
async def test_flush_error_fails_waiting_add():
    flush = AsyncMock(side_effect=RuntimeError("clickhouse down"))
    buf = BatchBuffer(flush=flush, max_size=1, max_seconds=60)

    with pytest.raises(RuntimeError, match="clickhouse down"):
        await buf.add(_envelope())
