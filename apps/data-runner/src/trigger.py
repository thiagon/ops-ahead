from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

from register_snapshot import register_snapshot as _register_snapshot
from settings import Settings
from steps import STEPS as _STEPS

LOGGER = logging.getLogger(__name__)

# full_pipeline isn't mapped here: it runs all three steps, not one.
ANALYSIS_STEPS = {"data_refresh": "transform", "data_quality_check": "quality"}

RegisterSnapshotFn = Callable[..., str]
StartAnalysisFn = Callable[..., str]

# Trainings that need a hold-out window to evaluate against; the rest take the
# analysis name alone (ml-trainer's SPLIT_REQUIRED_DOMAINS is the same split).
SPLIT_REQUIRED_ANALYSES = {"volume_forecast", "entity_forecast", "breach_risk"}


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _split_boundaries(settings: Settings, today: date) -> dict[str, str]:
    """Rolling windows ending yesterday — the last day whose incidents are all
    in. Fixed boundaries would silently stop moving as the data grows."""
    holdout_end = today - timedelta(days=1)
    validation_end = holdout_end - timedelta(days=settings.chain_holdout_days)
    train_end = validation_end - timedelta(days=settings.chain_validation_days)
    return {
        "train_end": train_end.isoformat(),
        "validation_end": validation_end.isoformat(),
        "holdout_end": holdout_end.isoformat(),
    }


def start_analysis(
    gateway_url: str, body: dict[str, Any], *, trigger: str, parent_id: str | None = None
) -> str:
    """POST /analyses as any other client would. The gateway mints the id, the
    update_key and the row, so a chained training is as queryable as one
    somebody asked for."""
    payload = {**body, "trigger": trigger}
    if parent_id:
        payload["parent_id"] = parent_id
    request = urllib.request.Request(
        f"{gateway_url.rstrip('/')}/analyses",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())["id"]


def chain_trainings(
    settings: Settings,
    parent_run_id: str,
    start: StartAnalysisFn = start_analysis,
    today: date | None = None,
) -> dict[str, Any]:
    """Starts the configured trainings off a finished full_pipeline.

    Called after the quality step, never before: that ordering is the whole
    point — a reproved suite raises and nothing here runs, so bad data cannot
    produce a new model.
    """
    splits = _split_boundaries(settings, today or datetime.now(UTC).date())
    started: dict[str, str] = {}
    failed: dict[str, str] = {}
    for analysis in settings.chained_analyses:
        body: dict[str, Any] = {"analysis": analysis}
        if analysis in SPLIT_REQUIRED_ANALYSES:
            body.update(splits)
        try:
            started[analysis] = start(
                settings.gateway_url, body, trigger="chained", parent_id=parent_run_id
            )
        except Exception as exc:
            # One training failing to start must not cost the others, and none
            # of it undoes the transformation that already ran.
            LOGGER.exception("could not chain %s off run_id=%s", analysis, parent_run_id)
            failed[analysis] = str(exc)
    return {"chained": started, "chain_failed": failed}


def report_status(gateway_url: str, payload: dict[str, Any], update_key: str | None) -> None:
    """PATCH /analyses/{id} with the update_key from the trigger.data message.

    A missing key means the message did not come from POST /analyses, which no
    producer does anymore; the branch stays as a defence, not a path.
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
    start: StartAnalysisFn = start_analysis,
) -> dict[str, Any]:
    """dbt run → great_expectations → register-snapshot → chain the trainings.

    Sequential in one container, and the order is the guarantee: the quality
    step raises before anything is chained, so a reproved suite never produces
    a new model.
    """
    steps["transform"]()
    steps["quality"](["--suite", "critical", "--upload-docs"])
    digest = register_snapshot(settings, dag_run_id=dag_run_id)
    detail: dict[str, Any] = {"snapshot_hash": digest}
    detail.update(chain_trainings(settings, dag_run_id, start=start))
    return detail


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
