from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from register_snapshot import register_snapshot as _register_snapshot
from settings import Settings
from steps import STEPS as _STEPS

LOGGER = logging.getLogger(__name__)

# full_pipeline isn't mapped here: it runs all three steps, not one.
ANALYSIS_STEPS = {"data_refresh": "transform", "data_quality_check": "quality"}

RegisterSnapshotFn = Callable[..., str]


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def report_status(gateway_url: str, payload: dict[str, Any], update_key: str | None) -> None:
    """PATCH /analyses/{id} with the update_key from the trigger.data message.

    Cron full_pipeline has no key (it never went through POST /analyses) and
    is skipped so a missing row does not fail the daily chain.
    """
    run_id = payload["run_id"]
    if not update_key:
        LOGGER.info("no update_key on event; skipping PATCH /analyses/%s", run_id)
        return

    body = {key: value for key, value in payload.items() if key != "run_id"}
    request = urllib.request.Request(
        f"{gateway_url.rstrip('/')}/analyses/{run_id}",
        data=json.dumps(body).encode(),
        method="PATCH",
        headers={"Content-Type": "application/json", "X-Update-Key": update_key},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        LOGGER.error("PATCH /analyses/%s failed: %s %s", run_id, exc.code, exc.read().decode())
        raise
    except urllib.error.URLError as exc:
        LOGGER.error("PATCH /analyses/%s unreachable: %s", run_id, exc.reason)
        raise


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
    publish_status({"run_id": run_id, "status": "running", "started_at": started_at})

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
                "status": "failed",
                "started_at": started_at,
                "finished_at": _now(),
                "detail": {"error": str(exc)},
            }
        )
    else:
        status: dict[str, Any] = {
            "run_id": run_id,
            "status": "succeeded",
            "started_at": started_at,
            "finished_at": _now(),
        }
        if detail:
            status["detail"] = detail
        publish_status(status)


def consume_forever(settings: Settings) -> None:
    """Real Kafka wiring: connects and processes trigger.data messages one at
    a time until SIGTERM. The Deployment's replica count (KEDA ScaledObject,
    scaling on the same topic's lag) is what grows/shrinks with load now —
    this loop itself never exits on its own. consumer_timeout_ms just bounds
    each poll so the loop wakes up to check for SIGTERM while idle."""
    import signal

    from kafka import KafkaConsumer

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

    stopping = False

    def _stop(signum: int, frame: object) -> None:
        nonlocal stopping
        LOGGER.info("SIGTERM received, finishing current message then stopping")
        stopping = True

    signal.signal(signal.SIGTERM, _stop)

    try:
        while not stopping:
            for record in consumer:
                event = record.value
                metrics.messages_consumed.labels(
                    analysis=event.get("analysis", "unknown")
                ).inc()

                def publish_status(
                    payload: dict[str, Any], _key: str | None = event.get("update_key")
                ) -> None:
                    report_status(settings.gateway_url, payload, _key)

                process_message(settings, event, publish_status)
                consumer.commit()
                if stopping:
                    break
    finally:
        consumer.close()
