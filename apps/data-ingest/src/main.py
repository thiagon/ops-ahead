import asyncio
import logging
import time

from faststream import FastStream
from faststream.kafka import KafkaBroker

import metrics
from buffer import BatchBuffer
from models import IncidentEnvelope
from settings import Settings
from writer import BatchWriter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def build_app(settings: Settings) -> tuple[FastStream, KafkaBroker]:
    broker = KafkaBroker(settings.kafka_bootstrap_servers)
    app = FastStream(broker)
    writer = BatchWriter(settings, publisher=broker)

    async def _flush(batch: list[IncidentEnvelope]) -> None:
        t0 = time.perf_counter()
        await writer.write(batch)
        metrics.batch_latency.observe(time.perf_counter() - t0)
        metrics.batch_size.observe(len(batch))

    buffer = BatchBuffer(
        flush=_flush,
        max_size=settings.batch_max_size,
        max_seconds=settings.batch_max_seconds,
    )

    # Same consumer group on both raw topics: this is the ingestion+translation
    # stage as a whole, not two independent processes
    # (docs/insights/fluxo-do-incidente.md — translation lives inside
    # data-ingest, not a separate app).
    @broker.subscriber(settings.kafka_topic_raw_alert, group_id=settings.kafka_group_id)
    async def handle_alert(msg: IncidentEnvelope) -> None:
        metrics.events_consumed.labels(source=msg.source, intake=msg.intake).inc()
        await buffer.add(msg)

    @broker.subscriber(settings.kafka_topic_raw_monitor, group_id=settings.kafka_group_id)
    async def handle_monitor(msg: IncidentEnvelope) -> None:
        metrics.events_consumed.labels(source=msg.source, intake=msg.intake).inc()
        await buffer.add(msg)

    @app.on_startup
    async def start_ticker() -> None:
        async def _tick() -> None:
            while True:
                await asyncio.sleep(1)
                await buffer.tick()

        asyncio.create_task(_tick())

    @app.on_shutdown
    async def drain_buffer() -> None:
        await buffer.drain()

    return app, broker


async def _main() -> None:
    settings = Settings()
    metrics.start(settings.metrics_port)
    app, _ = build_app(settings)
    await app.run()


if __name__ == "__main__":
    asyncio.run(_main())
