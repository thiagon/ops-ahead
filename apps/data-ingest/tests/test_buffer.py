import asyncio
import json
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from buffer import BatchBuffer
from models import IncidentEvent


def _evt() -> IncidentEvent:
    return IncidentEvent.model_validate(
        {
            "event_id": str(uuid4()),
            "source": "test",
            "received_at": "2024-01-15T10:00:00+00:00",
            "opened_at": "2024-01-15T09:55:00+00:00",
            "severity": 1,
            "entity_id": "host-01",
            "status": "open",
            "payload_raw": json.dumps({}),
        }
    )


@pytest.mark.asyncio
async def test_flush_on_max_size():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=3, max_seconds=60)

    for _ in range(3):
        await buf.add(_evt())

    flush.assert_awaited_once()
    batch = flush.call_args[0][0]
    assert len(batch) == 3


@pytest.mark.asyncio
async def test_no_flush_below_max_size():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=10, max_seconds=60)

    for _ in range(5):
        await buf.add(_evt())

    flush.assert_not_awaited()


@pytest.mark.asyncio
async def test_flush_on_time_deadline():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=1000, max_seconds=0.01)

    await buf.add(_evt())
    await asyncio.sleep(0.05)
    await buf.tick()

    flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_drain_flushes_remainder():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=1000, max_seconds=60)

    for _ in range(4):
        await buf.add(_evt())

    await buf.drain()
    flush.assert_awaited_once()
    assert len(flush.call_args[0][0]) == 4


@pytest.mark.asyncio
async def test_items_cleared_after_flush():
    flush = AsyncMock()
    buf = BatchBuffer(flush=flush, max_size=2, max_seconds=60)

    await buf.add(_evt())
    await buf.add(_evt())  # triggers flush
    await buf.add(_evt())
    await buf.drain()

    assert flush.await_count == 2
    # second flush only has 1 item
    assert len(flush.call_args_list[1][0][0]) == 1
