from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .register_snapshot import register_snapshot as _register_snapshot
from .settings import Settings
from .steps import STEPS as _STEPS

LOGGER = logging.getLogger(__name__)

# full_pipeline isn't mapped here: it runs all three steps, not one.
ANALYSIS_STEPS = {"data_refresh": "transform", "data_quality_check": "quality"}

RegisterSnapshotFn = Callable[..., str]


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def run_full_pipeline(
    settings: Settings,
    dag_run_id: str,
    steps: dict[str, Callable] = _STEPS,
    register_snapshot: RegisterSnapshotFn = _register_snapshot,
) -> dict[str, Any]:
    """dbt run → great_expectations suite critical → register-snapshot, the
    same three steps the old CronWorkflow ran, now sequential in one
    container triggered by the native CronJob (see spec.md)."""
    steps["transform"]()
    steps["quality"](["--suite", "critical", "--upload-docs"])
    digest = register_snapshot(settings, dag_run_id=dag_run_id)
    return {"snapshot_hash": digest}


def process_message(
    settings: Settings,
    event: dict[str, Any],
    publish_status: Callable[[dict[str, Any]], None],
    steps: dict[str, Callable] = _STEPS,
    register_snapshot: RegisterSnapshotFn = _register_snapshot,
) -> None:
    """Core of the `consume` mode, independent of the Kafka wiring so it can
    be unit tested with fake steps/register_snapshot and no broker."""
    try:
        run_id = event["run_id"]
        analysis = event["analysis"]
    except (KeyError, TypeError):
        LOGGER.error("dropping malformed trigger.data event: %r", event)
        return

    if analysis != "full_pipeline" and analysis not in ANALYSIS_STEPS:
        LOGGER.error(
            "dropping trigger.data event with unknown analysis=%r run_id=%s", analysis, run_id
        )
        return

    started_at = _now()
    publish_status({"run_id": run_id, "status": "Running", "started_at": started_at})

    try:
        if analysis == "full_pipeline":
            detail: dict[str, Any] | None = run_full_pipeline(
                settings, dag_run_id=run_id, steps=steps, register_snapshot=register_snapshot
            )
        else:
            step = ANALYSIS_STEPS[analysis]
            if step == "transform":
                steps["transform"]()
            else:
                steps["quality"](["--suite", "critical", "--upload-docs"])
            detail = None
    except Exception as exc:
        LOGGER.exception("run_id=%s failed", run_id)
        publish_status(
            {
                "run_id": run_id,
                "status": "Failed",
                "started_at": started_at,
                "finished_at": _now(),
                "detail": {"error": str(exc)},
            }
        )
    else:
        status: dict[str, Any] = {
            "run_id": run_id,
            "status": "Succeeded",
            "started_at": started_at,
            "finished_at": _now(),
        }
        if detail:
            status["detail"] = detail
        publish_status(status)


def consume_one(settings: Settings) -> None:
    """Real Kafka wiring: connects, reads exactly one message off
    trigger.data (or times out), and delegates to process_message. This is
    what the KEDA-triggered Job runs — one message in, a Running/terminal
    status pair out, then exit."""
    from kafka import KafkaConsumer, KafkaProducer

    consumer = KafkaConsumer(
        settings.kafka_topic,
        bootstrap_servers=settings.kafka_bootstrap_servers,
        group_id=settings.kafka_group_id,
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        consumer_timeout_ms=settings.kafka_consumer_timeout_ms,
        value_deserializer=lambda raw: json.loads(raw.decode()),
    )
    producer = KafkaProducer(bootstrap_servers=settings.kafka_bootstrap_servers)

    try:
        record = next(iter(consumer))
    except StopIteration:
        LOGGER.info("no message available on %s before timeout", settings.kafka_topic)
        consumer.close()
        producer.close()
        return

    def publish_status(payload: dict[str, Any]) -> None:
        producer.send(
            settings.kafka_topic_status,
            key=payload["run_id"].encode(),
            value=json.dumps(payload).encode(),
        )
        producer.flush()

    try:
        process_message(settings, record.value, publish_status)
    finally:
        consumer.commit()
        consumer.close()
        producer.close()
