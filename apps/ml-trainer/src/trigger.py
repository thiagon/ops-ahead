from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from src.settings import Settings

LOGGER = logging.getLogger(__name__)

ANALYSIS_TRAINERS = {"volume_forecast": "volume", "breach_risk": "breach"}

EXPERIMENT_NAMES = {"volume": "volume-forecast", "breach": "breach-risk"}


def configure_experiment(settings: Settings, domain: str) -> None:
    """Shared by the `train` CLI and the `consume` mode: a caller can still
    override either via env, but leaves it unset by default."""
    if settings.mlflow_experiment_name is None:
        settings.mlflow_experiment_name = EXPERIMENT_NAMES[domain]
    if settings.mlflow_registered_model_name is None:
        settings.mlflow_registered_model_name = EXPERIMENT_NAMES[domain]


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def process_message(
    settings: Settings,
    trainers: dict[str, Callable[[Settings], str]],
    event: dict[str, Any],
    publish_status: Callable[[dict[str, Any]], None],
) -> None:
    """Core of the `consume` mode, independent of the Kafka wiring so it can
    be unit tested with a fake publish_status, fake trainers, and no broker."""
    try:
        run_id = event["run_id"]
        analysis = event["analysis"]
    except (KeyError, TypeError):
        LOGGER.error("dropping malformed trigger.ml event: %r", event)
        return

    domain = ANALYSIS_TRAINERS.get(analysis)
    if domain is None:
        LOGGER.error(
            "dropping trigger.ml event with unknown analysis=%r run_id=%s", analysis, run_id
        )
        return

    started_at = _now()
    publish_status({"run_id": run_id, "status": "Running", "started_at": started_at})

    settings.train_end = event.get("train_end")
    settings.validation_end = event.get("validation_end")
    settings.holdout_end = event.get("holdout_end")
    configure_experiment(settings, domain)

    try:
        mlflow_run_id = trainers[domain](settings)
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
        publish_status(
            {
                "run_id": run_id,
                "status": "Succeeded",
                "started_at": started_at,
                "finished_at": _now(),
                "detail": {"mlflow_run_id": mlflow_run_id},
            }
        )


def consume_one(settings: Settings, trainers: dict[str, Callable[[Settings], str]]) -> None:
    """Real Kafka wiring: connects, reads exactly one message off trigger.ml
    (or times out), and delegates to process_message. This is what the
    KEDA-triggered Job runs — one message in, a Running/terminal status pair
    out, then exit."""
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
        process_message(settings, trainers, record.value, publish_status)
    finally:
        consumer.commit()
        consumer.close()
        producer.close()
