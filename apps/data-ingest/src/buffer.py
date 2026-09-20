import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Generic, TypeVar

T = TypeVar("T")


class BatchBuffer(Generic[T]):
    """Batches items until max_size or max_seconds. `add` does not return
    until that item has been flushed — the Kafka subscriber acks on return,
    so returning earlier would commit an offset the lake/ClickHouse never
    saw (KEDA scale-to-zero then has nothing left to drain)."""

    def __init__(
        self,
        flush: Callable[[list[T]], Awaitable[None]],
        max_size: int,
        max_seconds: float,
    ) -> None:
        self._flush = flush
        self._max_size = max_size
        self._max_seconds = max_seconds
        self._items: list[T] = []
        self._waiting: list[asyncio.Future[None]] = []
        self._deadline: float = time.monotonic() + max_seconds
        self._lock = asyncio.Lock()

    async def add(self, item: T) -> None:
        done: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        async with self._lock:
            self._items.append(item)
            self._waiting.append(done)
            if len(self._items) >= self._max_size:
                await self._do_flush()
        await done

    async def tick(self) -> None:
        """Call periodically to flush on time deadline."""
        async with self._lock:
            if self._items and time.monotonic() >= self._deadline:
                await self._do_flush()

    async def drain(self) -> None:
        async with self._lock:
            if self._items:
                await self._do_flush()

    async def _do_flush(self) -> None:
        batch, self._items = self._items, []
        waiting, self._waiting = self._waiting, []
        self._deadline = time.monotonic() + self._max_seconds
        try:
            await self._flush(batch)
        except Exception as exc:
            for fut in waiting:
                if not fut.done():
                    fut.set_exception(exc)
            return
        for fut in waiting:
            if not fut.done():
                fut.set_result(None)
