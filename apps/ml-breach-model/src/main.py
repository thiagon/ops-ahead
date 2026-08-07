from __future__ import annotations

import logging

from src.data import (
    dataset_version,
    fetch_eligible_incidents,
    fetch_group_load,
    fetch_ic_windows,
    fetch_p4_sequences,
)
from src.settings import Settings
from src.train import train_and_log

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def main() -> None:
    settings = Settings()
    incidents = fetch_eligible_incidents(settings)
    p4_sequences = fetch_p4_sequences(settings)
    ic_windows = fetch_ic_windows(settings)
    group_load = fetch_group_load(settings)

    version = dataset_version(incidents, p4_sequences, ic_windows, group_load)
    run_id = train_and_log(settings, incidents, p4_sequences, ic_windows, group_load, dataset_version=version)
    LOGGER.info("Training complete. MLflow run_id=%s", run_id)


if __name__ == "__main__":
    main()
