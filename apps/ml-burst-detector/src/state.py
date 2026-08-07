from __future__ import annotations

import redis.asyncio as redis

from src.detector import CusumState


class RedisState:
    """Per-(IC, window) state: the current bucket's live count, the rolling
    history of past completed buckets (the z-score baseline), and the CUSUM
    accumulators. Bucket rollover is detected lazily on event arrival — no
    separate ticker process — the outgoing bucket's final count is archived
    into history the moment the *first* event of the next bucket shows up.
    """

    def __init__(self, redis_url: str, history_length: int):
        self.redis = redis.from_url(redis_url, decode_responses=True)
        self.history_length = history_length

    async def record_event(
        self, entity_id: str, event_epoch: float, window_name: str, window_seconds: int
    ) -> tuple[int, list[float]]:
        bucket_id = int(event_epoch // window_seconds)
        bucket_key = f"burst:{entity_id}:{window_name}:bucket"
        history_key = f"burst:{entity_id}:{window_name}:history"

        stored = await self.redis.hgetall(bucket_key)
        if stored and int(stored["bucket_id"]) == bucket_id:
            count = int(stored["count"]) + 1
        else:
            if stored:
                await self.redis.lpush(history_key, stored["count"])
                await self.redis.ltrim(history_key, 0, self.history_length - 1)
            count = 1
        await self.redis.hset(bucket_key, mapping={"bucket_id": bucket_id, "count": count})

        raw_history = await self.redis.lrange(history_key, 0, -1)
        return count, [float(x) for x in raw_history]

    async def get_cusum(self, entity_id: str, window_name: str) -> CusumState:
        stored = await self.redis.hgetall(f"burst:{entity_id}:{window_name}:cusum")
        if not stored:
            return CusumState()
        return CusumState(s_pos=float(stored["s_pos"]), s_neg=float(stored["s_neg"]))

    async def set_cusum(self, entity_id: str, window_name: str, state: CusumState) -> None:
        await self.redis.hset(
            f"burst:{entity_id}:{window_name}:cusum",
            mapping={"s_pos": state.s_pos, "s_neg": state.s_neg},
        )

    async def close(self) -> None:
        await self.redis.aclose()
