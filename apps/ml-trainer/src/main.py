from __future__ import annotations

import logging
import sys

from settings import Settings
from trigger import configure_experiment

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def _train_volume(settings: Settings) -> str:
    from volume.data import dataset_version, fetch_gold_alert_daily_features
    from volume.train import train_and_log

    daily = fetch_gold_alert_daily_features(settings)
    return train_and_log(settings, daily, dataset_version=dataset_version(daily))


def _train_entity_forecast(settings: Settings) -> str:
    from entity_forecast.data import dataset_version, fetch_gold_alert_category_trends
    from entity_forecast.train import train_and_log

    trends = fetch_gold_alert_category_trends(settings)
    return train_and_log(settings, trends, dataset_version=dataset_version(trends))


def _train_breach(settings: Settings) -> str:
    from breach.data import (
        dataset_version,
        fetch_auto_resolution_rate,
        fetch_breach_training_examples,
        fetch_severity_escalations,
        fetch_signal_counts,
    )
    from breach.train import train_and_log

    examples = fetch_breach_training_examples(settings)
    signal_counts = fetch_signal_counts(settings)
    auto_resolution_rate = fetch_auto_resolution_rate(settings)
    severity_escalations = fetch_severity_escalations(settings)
    version = dataset_version(examples, signal_counts, auto_resolution_rate, severity_escalations)
    return train_and_log(
        settings, examples, signal_counts, auto_resolution_rate, severity_escalations, dataset_version=version
    )


def _train_external_event(settings: Settings) -> str:
    from external_event.data import dataset_version, fetch_gold_monitor_daily_features
    from external_event.train import train_and_log

    daily = fetch_gold_monitor_daily_features(settings)
    return train_and_log(settings, daily, dataset_version=dataset_version(daily))


def _train_kpi_projection(settings: Settings) -> str:
    from kpi_projection.data import fetch_kpi_achievement, fetch_kpi_monthly_state, fetch_kpi_targets
    from kpi_projection.run import run_kpi_projection
    from volume.data import fetch_gold_alert_daily_features

    daily = fetch_gold_alert_daily_features(settings)
    kpi_state = fetch_kpi_monthly_state(settings)
    achievement = fetch_kpi_achievement(settings)
    targets = fetch_kpi_targets(settings)
    return run_kpi_projection(settings, daily, kpi_state, achievement, targets)["run_id"]


def _run_drift(settings: Settings) -> str:
    import metrics
    from breach import features as breach_features
    from breach.data import (
        fetch_auto_resolution_rate,
        fetch_breach_training_examples,
        fetch_severity_escalations,
        fetch_signal_counts,
    )
    from drift.run import run_drift_monitoring
    from volume import features as volume_features
    from volume.data import fetch_gold_alert_daily_features

    daily = fetch_gold_alert_daily_features(settings)
    # Horizon doesn't change FEATURE_COLUMNS' own distribution meaningfully —
    # 1 is an arbitrary, stable choice, not a per-horizon drift concern.
    volume_frame = volume_features.build_feature_frame(daily, horizon=1)

    examples = fetch_breach_training_examples(settings)
    signal_counts = fetch_signal_counts(settings)
    auto_resolution_rate = fetch_auto_resolution_rate(settings)
    severity_escalations = fetch_severity_escalations(settings)
    breach_frame = breach_features.build_feature_frame(
        examples, signal_counts, auto_resolution_rate, severity_escalations, settings.breach_abandoned_ratio
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
    "entity_forecast": _train_entity_forecast,
    "breach": _train_breach,
    "external_event": _train_external_event,
    "kpi_projection": _train_kpi_projection,
    "drift": _run_drift,
}

# The supervised forecasts need a hold-out window to evaluate against;
# kpi_projection always forecasts from "now" forward and external_event trains
# unsupervised on all available history — neither takes split boundaries.
SPLIT_REQUIRED_DOMAINS = {"volume", "entity_forecast", "breach"}


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
        LOGGER.error("Usage: python -m main train <volume|entity_forecast|breach|external_event|kpi_projection|drift> | consume")
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
