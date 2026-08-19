from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from settings import Settings

LOGGER = logging.getLogger(__name__)

ANALYSIS_TRAINERS = {
    "volume_forecast": "volume",
    "breach_risk": "breach",
    "kpi_projection": "kpi_projection",
    "external_event_detection": "external_event",
    "drift_monitoring": "drift",
}

EXPERIMENT_NAMES = {
    "volume": "volume-forecast",
    "breach": "breach-risk",
    "external_event": "external-event-detection",
    "kpi_projection": "kpi-monthly-projection",
    "drift": "drift-monitoring",
}


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

    # consume_forever reuses one Settings instance for the process's whole
    # lifetime, across messages of possibly different domains — mutating it
    # in place leaks one message's fields into the next (e.g. a
    # volume_forecast run registering under breach-risk's name because a
    # breach_risk message set it first). A fresh copy per message, seeded
    # from the process's own env-derived settings, can never leak.
    message_settings = settings.model_copy()
    message_settings.train_end = event.get("train_end")
    message_settings.validation_end = event.get("validation_end")
    message_settings.holdout_end = event.get("holdout_end")
    message_settings.kpi_projection_n_simulations = event.get(
        "n_simulations", message_settings.kpi_projection_n_simulations
    )
    message_settings.kpi_projection_seed = event.get("seed", message_settings.kpi_projection_seed)
    message_settings.kpi_target_volume_p2 = event.get("kpi_target_volume_p2", message_settings.kpi_target_volume_p2)
    message_settings.kpi_target_volume_p3 = event.get("kpi_target_volume_p3", message_settings.kpi_target_volume_p3)
    message_settings.kpi_target_breaches_p2 = event.get(
        "kpi_target_breaches_p2", message_settings.kpi_target_breaches_p2
    )
    message_settings.kpi_target_breaches_p3 = event.get(
        "kpi_target_breaches_p3", message_settings.kpi_target_breaches_p3
    )
    message_settings.external_event_contamination = event.get(
        "contamination", message_settings.external_event_contamination
    )
    configure_experiment(message_settings, domain)

    try:
        mlflow_run_id = trainers[domain](message_settings)
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


def consume_forever(settings: Settings, trainers: dict[str, Callable[[Settings], str]]) -> None:
    """Real Kafka wiring: connects and processes trigger.ml messages one at a
    time until SIGTERM. The Deployment's replica count (KEDA ScaledObject,
    scaling on the same topic's lag) is what grows/shrinks with load now —
    this loop itself never exits on its own. consumer_timeout_ms just bounds
    each poll so the loop wakes up to check for SIGTERM while idle."""
    import signal

    from kafka import KafkaConsumer, KafkaProducer

    import metrics

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

    stopping = False

    def _stop(signum: int, frame: object) -> None:
        nonlocal stopping
        LOGGER.info("SIGTERM received, finishing current message then stopping")
        stopping = True

    signal.signal(signal.SIGTERM, _stop)

    def publish_status(payload: dict[str, Any]) -> None:
        producer.send(
            settings.kafka_topic_status,
            key=payload["run_id"].encode(),
            value=json.dumps(payload).encode(),
        )
        producer.flush()

    try:
        while not stopping:
            for record in consumer:
                metrics.messages_consumed.labels(
                    analysis=record.value.get("analysis", "unknown")
                ).inc()
                process_message(settings, trainers, record.value, publish_status)
                consumer.commit()
                if stopping:
                    break
    finally:
        consumer.close()
        producer.close()
