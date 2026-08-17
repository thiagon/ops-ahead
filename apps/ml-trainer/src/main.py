from __future__ import annotations

import logging
import sys

from src.settings import Settings
from src.trigger import configure_experiment

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def _train_volume(settings: Settings) -> str:
    from src.volume.data import dataset_version, fetch_daily_anomaly_features
    from src.volume.train import train_and_log

    daily = fetch_daily_anomaly_features(settings)
    return train_and_log(settings, daily, dataset_version=dataset_version(daily))


def _train_breach(settings: Settings) -> str:
    from src.breach.data import (
        dataset_version,
        fetch_eligible_incidents,
        fetch_group_load,
        fetch_ic_windows,
        fetch_p4_sequences,
    )
    from src.breach.train import train_and_log

    incidents = fetch_eligible_incidents(settings)
    p4_sequences = fetch_p4_sequences(settings)
    ic_windows = fetch_ic_windows(settings)
    group_load = fetch_group_load(settings)
    version = dataset_version(incidents, p4_sequences, ic_windows, group_load)
    return train_and_log(
        settings, incidents, p4_sequences, ic_windows, group_load, dataset_version=version
    )


TRAINERS = {"volume": _train_volume, "breach": _train_breach}


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
        from src import metrics
        from src.trigger import consume_forever

        settings = Settings()
        metrics.start(settings.metrics_port)
        consume_forever(settings, TRAINERS)
        return

    if len(sys.argv) != 3 or sys.argv[1] != "train" or sys.argv[2] not in TRAINERS:
        LOGGER.error("Usage: python -m src.main train <volume|breach> | consume")
        sys.exit(2)

    domain = sys.argv[2]
    settings = Settings()
    _require_split_boundaries(settings)
    configure_experiment(settings, domain)

    run_id = TRAINERS[domain](settings)
    LOGGER.info("Training complete. MLflow run_id=%s", run_id)


if __name__ == "__main__":
    main()
