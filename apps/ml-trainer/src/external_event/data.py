from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

GOLD_MONITOR_DAILY_FEATURES_COLUMNS = [
    "date",
    "source",
    "total_signals",
    "unique_entities",
    "firing_count",
    "cleared_count",
    "p1_share",
    "critical_share",
]


def fetch_gold_monitor_daily_features(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(GOLD_MONITOR_DAILY_FEATURES_COLUMNS)
    rows = client.execute(f"select {columns} from gold_monitor_daily_features order by date")
    return pd.DataFrame(rows, columns=GOLD_MONITOR_DAILY_FEATURES_COLUMNS)


def dataset_version(daily: pd.DataFrame) -> str:
    """Deterministic fingerprint of the exact rows a run trained on — same
    approach as `volume.data.dataset_version`/`breach.data.dataset_version`."""
    digest = hashlib.sha256(pd.util.hash_pandas_object(daily, index=False).values.tobytes())
    return digest.hexdigest()[:16]
