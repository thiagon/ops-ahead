from __future__ import annotations

import logging

import redis
from clickhouse_driver import Client

from settings import Settings

LOGGER = logging.getLogger(__name__)

_KEY_PREFIX = "monitor:signal_count"
_WINDOW_MINUTES = 15


def read_signal_counts(client: Client, window_minutes: int = _WINDOW_MINUTES) -> dict[str, int]:
    """Latest 15-minute signal count per entity — the correlation feature
    the breach-risk inference path reads (domain spec: "as duas cadeias se
    encontram por entity"). One row per entity even though
    gold_monitor_signal_counts carries many historical windows."""
    rows = client.execute(
        "SELECT entity_id, argMax(signal_count, window_start) "
        "FROM gold_monitor_signal_counts WHERE window_minutes = %(window_minutes)s "
        "GROUP BY entity_id",
        {"window_minutes": window_minutes},
    )
    return {entity_id: count for entity_id, count in rows}


def publish_snapshot(
    settings: Settings,
    client: Client | None = None,
    redis_client: "redis.Redis | None" = None,
) -> int:
    """Cache-aside snapshot: refreshed here on every data_refresh run, read
    by inference without touching ClickHouse (see
    apps/data-runner/models/gold/gold_monitor_signal_counts.sql). TTL matches
    the window — a 15-minute count is stale past its own window.
    `client`/`redis_client` are injectable for tests. Returns how many
    entities were published."""
    client = client if client is not None else Client.from_url(settings.clickhouse_native_url)
    redis_client = redis_client if redis_client is not None else redis.from_url(settings.redis_url)

    counts = read_signal_counts(client)
    ttl_seconds = _WINDOW_MINUTES * 60
    for entity_id, count in counts.items():
        redis_client.set(f"{_KEY_PREFIX}:{entity_id}", count, ex=ttl_seconds)

    LOGGER.info("published monitor signal-count snapshot for %d entities", len(counts))
    return len(counts)
