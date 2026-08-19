from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

DAILY_ANOMALY_FEATURES_COLUMNS = [
    "date",
    "source",
    "total_incidents",
    "p1_share",
    "manual_open_share",
    "no_intervention_share",
    "unique_entities",
]


def fetch_daily_anomaly_features(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(DAILY_ANOMALY_FEATURES_COLUMNS)
    rows = client.execute(f"select {columns} from daily_anomaly_features order by date")
    return pd.DataFrame(rows, columns=DAILY_ANOMALY_FEATURES_COLUMNS)


def dataset_version(daily: pd.DataFrame) -> str:
    """Deterministic fingerprint of the exact rows a run trained on — same
    approach as `volume.data.dataset_version`/`breach.data.dataset_version`."""
    digest = hashlib.sha256(pd.util.hash_pandas_object(daily, index=False).values.tobytes())
    return digest.hexdigest()[:16]
