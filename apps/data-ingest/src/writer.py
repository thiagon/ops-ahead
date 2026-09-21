import io
import json
import logging
from datetime import UTC
from typing import Protocol

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from clickhouse_driver import Client

import metrics
from bindings import BindingRegistry
from dictionaries import DictionaryRegistry
from models import BronzeAlertEvent, BronzeMonitorEvent, EventEnvelope, MilestoneEvent
from settings import Settings
from translate import UnknownSourceError, translate

logger = logging.getLogger(__name__)

_CLICKHOUSE_INSERT_ALERT = """
    INSERT INTO bronze_alert
    (event_id, tenant_id, source, version, dictionary_version, received_at, external_id,
     opened_at, acknowledged_at, resolved_at, closed_at, severity, status, entity_id, title,
     description, owner, reported_by, parent_id, resolution_code, resolution_summary, labels,
     source_url)
    VALUES
"""

_CLICKHOUSE_INSERT_MONITOR = """
    INSERT INTO bronze_monitor
    (event_id, tenant_id, source, version, dictionary_version, received_at, external_id,
     started_at, ended_at, severity, condition, entity_id, title, description, labels,
     source_url)
    VALUES
"""

_CLICKHOUSE_INSERT_MILESTONE = """
    INSERT INTO bronze_deadline_milestone
    (event_id, tenant_id, source, external_id, entity_id, kind, severity, opened_at,
     acknowledged_at, due_at, deadline_seconds, consumed_ratio, occurred_at)
    VALUES
"""


_CLICKHOUSE_INSERT_DEADLINE = """
    INSERT INTO tenant_deadlines (tenant_id, severity, deadline_seconds, updated_at) VALUES
"""

_CLICKHOUSE_INSERT_KPI_TARGET = """
    INSERT INTO tenant_kpi_targets
    (tenant_id, severities, max_breaches, achievement_pct, updated_at)
    VALUES
"""


class Publisher(Protocol):
    # bytes, not str: a str payload reaches the consumer as a str, and a
    # handler typed with its event model then gets the raw JSON text where it
    # expects a mapping.
    async def publish(self, message: bytes, topic: str) -> None: ...


def _naive_utc(dt):
    return dt.astimezone(UTC).replace(tzinfo=None) if dt is not None else None


def _alert_row(evt: BronzeAlertEvent) -> tuple:
    return (
        str(evt.event_id),
        evt.tenant_id,
        evt.source,
        evt.version,
        evt.dictionary_version,
        _naive_utc(evt.received_at),
        evt.external_id,
        _naive_utc(evt.opened_at),
        _naive_utc(evt.acknowledged_at),
        _naive_utc(evt.resolved_at),
        _naive_utc(evt.closed_at),
        evt.severity,
        evt.status,
        evt.entity_id or "",
        evt.title,
        evt.description or "",
        evt.owner or "",
        evt.reported_by or "",
        evt.parent_id or "",
        evt.resolution_code or "",
        evt.resolution_summary or "",
        evt.labels or {},
        evt.source_url or "",
    )


def _monitor_row(evt: BronzeMonitorEvent) -> tuple:
    return (
        str(evt.event_id),
        evt.tenant_id,
        evt.source,
        evt.version,
        evt.dictionary_version,
        _naive_utc(evt.received_at),
        evt.external_id,
        _naive_utc(evt.started_at),
        _naive_utc(evt.ended_at),
        evt.severity,
        evt.condition,
        evt.entity_id,
        evt.title or "",
        evt.description or "",
        evt.labels or {},
        evt.source_url or "",
    )


def _milestone_row(evt: MilestoneEvent) -> tuple:
    return (
        str(evt.event_id),
        evt.tenant_id,
        evt.source,
        evt.external_id,
        evt.entity_id or "",
        evt.kind,
        evt.severity,
        _naive_utc(evt.opened_at),
        _naive_utc(evt.acknowledged_at),
        _naive_utc(evt.due_at),
        evt.deadline_seconds,
        evt.consumed_ratio,
        _naive_utc(evt.occurred_at),
    )


def _lake_prefix(envelope: EventEnvelope) -> str:
    date = envelope.received_at.astimezone(UTC).date()
    return f"raw/tenant={envelope.tenant_id}/intake={envelope.intake}/source={envelope.source}/date={date}/"


class BatchWriter:
    """One handler, sequential steps — no separate app for translation
    (docs/insights/fluxo-do-incidente.md): the raw body is written to the lake
    before any interpretation, then each envelope is translated and the bronze
    row + the translated event are produced together."""

    def __init__(
        self,
        settings: Settings,
        publisher: Publisher,
        dictionaries: DictionaryRegistry,
        bindings: BindingRegistry,
    ) -> None:
        self._settings = settings
        self._publisher = publisher
        self._dictionaries = dictionaries
        self._bindings = bindings
        self._ch = Client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            database=settings.clickhouse_database,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
        )
        self._s3 = boto3.client(
            "s3",
            endpoint_url=settings.minio_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
        )
        self._bucket = settings.minio_bucket

    def replace_deadlines(self, rows: list[tuple]) -> None:
        """Materializes one tenant's deadlines for the dbt models to join
        against. ReplacingMergeTree keeps the latest row per key, so a
        correction is an insert, never a delete-then-insert."""
        if rows:
            self._ch.execute(_CLICKHOUSE_INSERT_DEADLINE, rows)

    def replace_kpi_targets(self, rows: list[tuple]) -> None:
        if rows:
            self._ch.execute(_CLICKHOUSE_INSERT_KPI_TARGET, rows)

    async def write(self, batch: list[EventEnvelope]) -> None:
        # The raw body reaches the lake before any interpretation: the lake
        # write never depends on translation succeeding.
        self._write_lake(batch)

        alert_rows: list[tuple] = []
        monitor_rows: list[tuple] = []
        translated: list[tuple[bytes, str]] = []
        for envelope in batch:
            try:
                bronze = translate(envelope, self._dictionaries, self._bindings)
            except UnknownSourceError:
                metrics.translation_failures.labels(source=envelope.source, intake=envelope.intake).inc()
                logger.warning(
                    "no configuration for tenant=%s source=%s intake=%s — event kept in the "
                    "lake, skipped for bronze",
                    envelope.tenant_id,
                    envelope.source,
                    envelope.intake,
                )
                continue

            payload = bronze.model_dump_json().encode()
            if isinstance(bronze, BronzeAlertEvent):
                alert_rows.append(_alert_row(bronze))
                translated.append((payload, self._settings.kafka_topic_alert))
            else:
                monitor_rows.append(_monitor_row(bronze))
                translated.append((payload, self._settings.kafka_topic_monitor))

        if alert_rows:
            self._ch.execute(_CLICKHOUSE_INSERT_ALERT, alert_rows)
            logger.info("clickhouse: inserted %d bronze_alert rows", len(alert_rows))
        if monitor_rows:
            self._ch.execute(_CLICKHOUSE_INSERT_MONITOR, monitor_rows)
            logger.info("clickhouse: inserted %d bronze_monitor rows", len(monitor_rows))

        # Last, because it is the only effect here a retry cannot repeat
        # harmlessly: the lake write is keyed by content and bronze collapses
        # a repeated event_id, so replaying the batch leaves no trace of the
        # first attempt — a republished event would reach every downstream
        # consumer twice.
        for payload, topic in translated:
            await self._publisher.publish(payload, topic=topic)

    async def write_milestones(self, batch: list[MilestoneEvent]) -> None:
        rows = [_milestone_row(evt) for evt in batch]
        self._ch.execute(_CLICKHOUSE_INSERT_MILESTONE, rows)
        logger.info("clickhouse: inserted %d bronze_deadline_milestone rows", len(rows))

    def _write_lake(self, batch: list[EventEnvelope]) -> None:
        # Grouped by (tenant, intake, source, date de recepção) — reprocessar é
        # sempre "reler o que chegou entre tal e tal dia".
        groups: dict[str, list[EventEnvelope]] = {}
        for envelope in batch:
            groups.setdefault(_lake_prefix(envelope), []).append(envelope)

        for prefix, envelopes in groups.items():
            table = pa.Table.from_pylist([json.loads(e.model_dump_json()) for e in envelopes])
            buf = io.BytesIO()
            pq.write_table(table, buf)
            buf.seek(0)
            ts = envelopes[0].received_at.astimezone(UTC).strftime("%Y%m%dT%H%M%S%fZ")
            object_key = f"{prefix}{ts}.parquet"
            self._s3.put_object(Bucket=self._bucket, Key=object_key, Body=buf)
            logger.info("lake: wrote %s (%d events)", object_key, len(envelopes))
