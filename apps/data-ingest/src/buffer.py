import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Generic, TypeVar

T = TypeVar("T")


class BatchBuffer(Generic[T]):
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
        self._deadline: float = time.monotonic() + max_seconds
        self._lock = asyncio.Lock()

    async def add(self, item: T) -> None:
        async with self._lock:
            self._items.append(item)
            if len(self._items) >= self._max_size:
                await self._do_flush()

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
        self._deadline = time.monotonic() + self._max_seconds
        await self._flush(batch)
