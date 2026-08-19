from __future__ import annotations

import asyncio
import logging

from faststream import FastStream
from faststream.kafka import KafkaBroker

import metrics
from detector import (
    CUSUM_H,
    CUSUM_K,
    HISTORY_LENGTH,
    WINDOWS_SECONDS,
    Z_SCORE_THRESHOLD,
    robust_std_from_mad,
    robust_z_score,
    update_cusum,
)
from models import BurstAlert, IncidentEvent
from settings import Settings
from state import RedisState

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def build_app(settings: Settings) -> tuple[FastStream, KafkaBroker]:
    broker = KafkaBroker(settings.kafka_bootstrap_servers)
    app = FastStream(broker)
    state = RedisState(settings.redis_url, HISTORY_LENGTH)

    async def _process_window(msg: IncidentEvent, window_name: str, window_seconds: int) -> None:
        event_epoch = msg.opened_at.timestamp()
        count, history = await state.record_event(msg.entity_id, event_epoch, window_name, window_seconds)
        z, median, mad = robust_z_score(count, history)
        robust_std = robust_std_from_mad(mad)

        alert: BurstAlert | None = None
        # Spikes only look "up" — a quiet window isn't a burst.
        if z > Z_SCORE_THRESHOLD:
            alert = BurstAlert(
                entity_id=msg.entity_id,
                alert_type="spike",
                window_name=window_name,
                z_score=z,
                current_count=count,
                median=median,
                mad=mad,
                detected_at=msg.received_at,
            )

        cusum_state = await state.get_cusum(msg.entity_id, window_name)
        new_cusum_state, triggered = update_cusum(cusum_state, count, median, robust_std, CUSUM_K, CUSUM_H)
        await state.set_cusum(msg.entity_id, window_name, new_cusum_state)

        if triggered and alert is None:
            alert = BurstAlert(
                entity_id=msg.entity_id,
                alert_type="regime_change",
                window_name=window_name,
                z_score=z,
                current_count=count,
                median=median,
                mad=mad,
                detected_at=msg.received_at,
            )

        if alert is not None:
            metrics.alerts_published.labels(alert_type=alert.alert_type, window=window_name).inc()
            await broker.publish(alert.model_dump_json().encode(), settings.alert_topic)

    @broker.subscriber(settings.kafka_topic, group_id=settings.kafka_group_id)
    async def handle(msg: IncidentEvent) -> None:
        metrics.events_consumed.inc()
        for window_name, window_seconds in WINDOWS_SECONDS.items():
            await _process_window(msg, window_name, window_seconds)

    @app.on_shutdown
    async def close_state() -> None:
        await state.close()

    return app, broker


async def _main() -> None:
    settings = Settings()
    metrics.start(settings.metrics_port)
    app, _ = build_app(settings)
    await app.run()


if __name__ == "__main__":
    asyncio.run(_main())
