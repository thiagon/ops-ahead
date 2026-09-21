import asyncio
import logging
import time
import uuid
from typing import Any, Callable

from faststream import FastStream
from faststream.kafka import KafkaBroker
from faststream.kafka.annotations import KafkaMessage

import metrics
from bindings import BindingRegistry
from buffer import BatchBuffer
from config_store import ConfigStore
from config_stream import (
    apply_deadline_rows,
    apply_mapping,
    apply_target_rows,
    load_snapshot_from_store,
    parse_config_record,
)
from dictionaries import DictionaryRegistry
from models import EventEnvelope, MilestoneEvent
from settings import Settings
from writer import BatchWriter

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _key(message) -> str | None:
    """The record's Kafka key, which is what identifies the origin a rule
    describes — the value alone does not, since a tombstone carries none."""
    raw = getattr(message.raw_message, "key", None)
    if raw is None:
        return None
    return raw.decode("utf-8") if isinstance(raw, bytes) else str(raw)


def _persist_mapping(save: Callable[[str, str, dict[str, Any]], None], raw: bytes | None) -> None:
    """Mirrors a rules.mapping record into MinIO after it is applied in
    memory. A tombstone or malformed record has nothing to persist — this
    track publishes no tombstone, so seeing one here means a legacy producer,
    and the existing on-disk record is left alone."""
    record = parse_config_record(raw)
    if record is None:
        return
    tenant_id, source = record.get("tenant_id"), record.get("source")
    if tenant_id and source:
        save(tenant_id, source, record)


def _persist_tenant_rule(save: Callable[[str, dict[str, Any]], None], raw: bytes | None) -> None:
    """Mirrors a rules.deadline/rules.target record into MinIO."""
    record = parse_config_record(raw)
    if record is None:
        return
    tenant_id = record.get("tenant_id")
    if tenant_id:
        save(tenant_id, record)


def build_app(settings: Settings) -> tuple[FastStream, KafkaBroker]:
    broker = KafkaBroker(settings.kafka_bootstrap_servers)
    app = FastStream(broker)
    dictionaries = DictionaryRegistry()
    bindings = BindingRegistry()
    writer = BatchWriter(
        settings, publisher=broker, dictionaries=dictionaries, bindings=bindings
    )
    config_store = ConfigStore(writer._s3, settings.minio_bucket)

    # Blocking, before any subscriber is declared: a consumer that started
    # translating against an empty registry would drop events translate.py
    # is only missing because the snapshot had not loaded yet.
    snapshot = load_snapshot_from_store(config_store, bindings, dictionaries)
    writer.replace_deadlines(snapshot.deadline_rows)
    writer.replace_kpi_targets(snapshot.target_rows)

    # Unique per boot, unlike the fixed group on the raw topics: every replica
    # needs the whole rules log, not a partition of it.
    rules_group = f"rules-ingest-{uuid.uuid4()}"

    @broker.subscriber(
        settings.kafka_topic_rules_mapping, group_id=rules_group, auto_offset_reset="earliest"
    )
    async def handle_rules_mapping(msg: KafkaMessage) -> None:
        apply_mapping(bindings, dictionaries, _key(msg), msg.body)
        _persist_mapping(config_store.save_mapping, msg.body)

    async def _flush(batch: list[EventEnvelope]) -> None:
        t0 = time.perf_counter()
        await writer.write(batch)
        metrics.batch_latency.observe(time.perf_counter() - t0)
        metrics.batch_size.observe(len(batch))

    buffer = BatchBuffer(
        flush=_flush,
        max_size=settings.batch_max_size,
        max_seconds=settings.batch_max_seconds,
    )
    milestone_buffer = BatchBuffer(
        flush=writer.write_milestones,
        max_size=settings.batch_max_size,
        max_seconds=settings.batch_max_seconds,
    )

    # Same consumer group on both raw topics: this is the ingestion+translation
    # stage as a whole, not two independent processes
    # (docs/insights/fluxo-do-incidente.md — translation lives inside
    # data-ingest, not a separate app).
    # The dbt models join these as tables, not as a stream: the topic is
    # materialized here so data-runner reads the rules the same way it reads
    # everything else.
    @broker.subscriber(
        settings.kafka_topic_rules_deadline, group_id=rules_group, auto_offset_reset="earliest"
    )
    async def handle_rules_deadline(msg: KafkaMessage) -> None:
        rows = apply_deadline_rows(_key(msg), msg.body)
        if rows:
            writer.replace_deadlines(rows)
        _persist_tenant_rule(config_store.save_deadlines, msg.body)

    @broker.subscriber(
        settings.kafka_topic_rules_target,
        group_id=rules_group,
        auto_offset_reset="earliest",
    )
    async def handle_rules_target(msg: KafkaMessage) -> None:
        rows = apply_target_rows(_key(msg), msg.body)
        if rows:
            writer.replace_kpi_targets(rows)
        _persist_tenant_rule(config_store.save_targets, msg.body)

    @broker.subscriber(settings.kafka_topic_raw_alert, group_id=settings.kafka_group_id)
    async def handle_alert(msg: EventEnvelope) -> None:
        metrics.events_consumed.labels(source=msg.source, intake=msg.intake).inc()
        await buffer.add(msg)

    @broker.subscriber(settings.kafka_topic_raw_monitor, group_id=settings.kafka_group_id)
    async def handle_monitor(msg: EventEnvelope) -> None:
        metrics.events_consumed.labels(source=msg.source, intake=msg.intake).inc()
        await buffer.add(msg)

    # Already canonical (apps/data-deadline-tracker) — no raw topic, no lake,
    # no translation, straight to bronze_deadline_milestone.
    @broker.subscriber(settings.kafka_topic_milestone, group_id=settings.kafka_group_id)
    async def handle_milestone(msg: MilestoneEvent) -> None:
        metrics.milestones_consumed.labels(kind=msg.kind).inc()
        await milestone_buffer.add(msg)

    @app.on_startup
    async def start_ticker() -> None:
        async def _tick() -> None:
            while True:
                await asyncio.sleep(1)
                await buffer.tick()
                await milestone_buffer.tick()

        asyncio.create_task(_tick())

    @app.on_shutdown
    async def drain_buffer() -> None:
        await buffer.drain()
        await milestone_buffer.drain()

    return app, broker


async def _main() -> None:
    settings = Settings()
    metrics.start(settings.metrics_port)
    app, _ = build_app(settings)
    await app.run()


if __name__ == "__main__":
    asyncio.run(_main())
