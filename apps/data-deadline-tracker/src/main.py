import asyncio
import logging
from datetime import datetime, timezone
from uuid import uuid4

from clickhouse_driver import Client
from faststream import FastStream
from faststream.kafka import KafkaBroker

import metrics
from deadlines import DeadlineTable
from models import IncidentAlertEvent, MilestoneEvent
from settings import Settings
from tracker import OccurrenceTracker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def build_app(settings: Settings) -> tuple[FastStream, KafkaBroker]:
    broker = KafkaBroker(settings.kafka_bootstrap_servers)
    app = FastStream(broker)

    deadlines = DeadlineTable()
    tracker = OccurrenceTracker(deadlines, settings.abandoned_ratio)

    async def _publish(milestones: list[MilestoneEvent]) -> None:
        for milestone in milestones:
            metrics.milestones_published.labels(kind=milestone.kind, severity=milestone.severity).inc()
            await broker.publish(milestone.model_dump_json().encode(), settings.kafka_topic_milestones)
        metrics.open_occurrences.set(len(tracker))

    # Unique per boot, never fixed — state is reconstructed from ClickHouse
    # on every startup (reconstruct(), below), so this only needs to pick up
    # events from here forward. A fixed/shared group would risk resuming
    # from a stale committed offset instead of reconciling with what
    # reconstruction already accounts for (opposite of data-runner/
    # ml-trainer's own consumer group, which must stay fixed).
    group_id = f"{settings.kafka_group_id_prefix}-{uuid4()}"

    @broker.subscriber(settings.kafka_topic_alert, group_id=group_id)
    async def handle_alert(event: IncidentAlertEvent) -> None:
        metrics.events_consumed.inc()
        tracker.apply_event(event)
        # React immediately rather than waiting for the next tick — a
        # severity change can jump an occurrence straight past pct_100
        # (task 6.5: "disparando o de 100% na hora").
        await _publish(tracker.check(datetime.now(timezone.utc)))

    @app.on_startup
    async def startup() -> None:
        client = Client.from_url(settings.clickhouse_url)
        deadlines.refresh(client)
        tracker.reconstruct(client)
        metrics.open_occurrences.set(len(tracker))
        logger.info("reconstructed %d open occurrences", len(tracker))

        async def _tick() -> None:
            while True:
                await asyncio.sleep(settings.tick_seconds)
                deadlines.refresh(client)
                await _publish(tracker.check(datetime.now(timezone.utc)))

        asyncio.create_task(_tick())

    return app, broker


async def _main() -> None:
    settings = Settings()
    metrics.start(settings.metrics_port)
    app, _ = build_app(settings)
    await app.run()


if __name__ == "__main__":
    asyncio.run(_main())
