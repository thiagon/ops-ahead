from __future__ import annotations

import asyncio
import logging

from faststream import FastStream
from faststream.kafka import KafkaBroker

import metrics
from formatting import build_summary
from models import IncidentAlertEvent
from settings import Settings
from slack_client import SlackNotifier

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def build_app(settings: Settings) -> tuple[FastStream, KafkaBroker]:
    broker = KafkaBroker(settings.kafka_bootstrap_servers)
    app = FastStream(broker)
    notifier = SlackNotifier(settings.slack_bot_token, settings.slack_channel_id)

    @broker.subscriber(settings.kafka_topic, group_id=settings.kafka_group_id)
    async def handle(msg: IncidentAlertEvent) -> None:
        metrics.events_consumed.inc()
        text, blocks = build_summary(msg)
        try:
            await notifier.send(text, blocks)
        except Exception:
            metrics.notifications_failed.inc()
            raise
        metrics.notifications_sent.inc()

    return app, broker


async def _main() -> None:
    settings = Settings()
    metrics.start(settings.metrics_port)
    app, _ = build_app(settings)
    await app.run()


if __name__ == "__main__":
    asyncio.run(_main())
