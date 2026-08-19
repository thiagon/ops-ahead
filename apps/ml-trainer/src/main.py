from __future__ import annotations

import logging
import sys

from settings import Settings
from trigger import configure_experiment

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def _train_volume(settings: Settings) -> str:
    from volume.data import dataset_version, fetch_daily_anomaly_features
    from volume.train import train_and_log

    daily = fetch_daily_anomaly_features(settings)
    return train_and_log(settings, daily, dataset_version=dataset_version(daily))


def _train_breach(settings: Settings) -> str:
    from breach.data import (
        dataset_version,
        fetch_eligible_incidents,
        fetch_group_load,
        fetch_ic_windows,
        fetch_p4_sequences,
        fetch_priority_changes,
    )
    from breach.train import train_and_log

    incidents = fetch_eligible_incidents(settings)
    p4_sequences = fetch_p4_sequences(settings)
    ic_windows = fetch_ic_windows(settings)
    group_load = fetch_group_load(settings)
    priority_changes = fetch_priority_changes(settings)
    version = dataset_version(incidents, p4_sequences, ic_windows, group_load, priority_changes)
    return train_and_log(
        settings, incidents, p4_sequences, ic_windows, group_load, priority_changes, dataset_version=version
    )


def _train_external_event(settings: Settings) -> str:
    from external_event.data import dataset_version, fetch_daily_anomaly_features
    from external_event.train import train_and_log

    daily = fetch_daily_anomaly_features(settings)
    return train_and_log(settings, daily, dataset_version=dataset_version(daily))


def _train_kpi_projection(settings: Settings) -> str:
    from kpi_projection.data import fetch_kpi_monthly_state
    from kpi_projection.run import run_kpi_projection
    from volume.data import fetch_daily_anomaly_features

    daily = fetch_daily_anomaly_features(settings)
    kpi_state = fetch_kpi_monthly_state(settings)
    return run_kpi_projection(settings, daily, kpi_state)["run_id"]


def _run_drift(settings: Settings) -> str:
    import metrics
    from breach import features as breach_features
    from breach.data import (
        fetch_eligible_incidents,
        fetch_group_load,
        fetch_ic_windows,
        fetch_p4_sequences,
        fetch_priority_changes,
    )
    from drift.run import run_drift_monitoring
    from volume import features as volume_features
    from volume.data import fetch_daily_anomaly_features

    daily = fetch_daily_anomaly_features(settings)
    # Horizon doesn't change FEATURE_COLUMNS' own distribution meaningfully —
    # 1 is an arbitrary, stable choice, not a per-horizon drift concern.
    volume_frame = volume_features.build_feature_frame(daily, horizon=1)

    incidents = fetch_eligible_incidents(settings)
    p4_sequences = fetch_p4_sequences(settings)
    ic_windows = fetch_ic_windows(settings)
    group_load = fetch_group_load(settings)
    priority_changes = fetch_priority_changes(settings)
    breach_frame = breach_features.build_feature_frame(
        incidents, p4_sequences, ic_windows, group_load, priority_changes
    )

    domains = {
        "volume": (volume_frame, "date", volume_features.FEATURE_COLUMNS),
        "breach": (breach_frame, "opened_at", breach_features.FEATURE_COLUMNS),
    }
    outcome = run_drift_monitoring(settings, domains)

    for domain, domain_results in outcome["results"].items():
        for feature, result in domain_results.items():
            metrics.feature_drift_psi.labels(domain=domain, feature=feature).set(result.psi)
            if result.ks_pvalue is not None:
                metrics.feature_drift_ks_pvalue.labels(domain=domain, feature=feature).set(result.ks_pvalue)

    return outcome["run_id"]


TRAINERS = {
    "volume": _train_volume,
    "breach": _train_breach,
    "external_event": _train_external_event,
    "kpi_projection": _train_kpi_projection,
    "drift": _run_drift,
}

# volume/breach need a hold-out window to evaluate against; kpi_projection
# always forecasts from "now" forward and external_event trains unsupervised
# on all available history — neither takes split boundaries.
SPLIT_REQUIRED_DOMAINS = {"volume", "breach"}


def _require_split_boundaries(settings: Settings) -> None:
    missing = [
        name
        for name, value in (
            ("TRAIN_END", settings.train_end),
            ("VALIDATION_END", settings.validation_end),
            ("HOLDOUT_END", settings.holdout_end),
        )
        if value is None
    ]
    if missing:
        raise ValueError(f"Missing required split boundaries: {', '.join(missing)}")


def main() -> None:
    if len(sys.argv) == 2 and sys.argv[1] == "consume":
        import metrics
        from trigger import consume_forever

        settings = Settings()
        metrics.start(settings.metrics_port)
        consume_forever(settings, TRAINERS)
        return

    if len(sys.argv) != 3 or sys.argv[1] != "train" or sys.argv[2] not in TRAINERS:
        LOGGER.error("Usage: python -m main train <volume|breach|external_event|kpi_projection|drift> | consume")
        sys.exit(2)

    domain = sys.argv[2]
    settings = Settings()
    if domain in SPLIT_REQUIRED_DOMAINS:
        _require_split_boundaries(settings)
    configure_experiment(settings, domain)

    run_id = TRAINERS[domain](settings)
    LOGGER.info("Training complete. MLflow run_id=%s", run_id)


if __name__ == "__main__":
    main()
