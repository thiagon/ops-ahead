from __future__ import annotations

import logging

from src.data import dataset_version, fetch_daily_anomaly_features
from src.settings import Settings
from src.train import train_and_log

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def main() -> None:
    settings = Settings()
    daily = fetch_daily_anomaly_features(settings)
    run_id = train_and_log(settings, daily, dataset_version=dataset_version(daily))
    LOGGER.info("Training complete. MLflow run_id=%s", run_id)


if __name__ == "__main__":
    main()
