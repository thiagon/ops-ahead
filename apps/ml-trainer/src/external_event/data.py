from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

GOLD_ALERT_DAILY_FEATURES_COLUMNS = [
    "date",
    "source",
    "total_incidents",
    "unique_entities",
    "incidents_per_entity",
    "critical_share",
    "manual_open_share",
]

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


def _fetch(settings: Settings, table: str, columns: list[str]) -> pd.DataFrame:
    """Both marts are per (tenant, date, source); a run covers one tenant, so
    the filter belongs in the query rather than in pandas afterwards."""
    client = Client.from_url(settings.clickhouse_url)
    selected = ", ".join(columns)
    rows = client.execute(
        f"select {selected} from {table} where tenant_id = %(tenant_id)s order by date",
        {"tenant_id": settings.tenant_id},
    )
    return pd.DataFrame(rows, columns=columns)


def fetch_gold_alert_daily_features(settings: Settings) -> pd.DataFrame:
    return _fetch(settings, "gold_alert_daily_features", GOLD_ALERT_DAILY_FEATURES_COLUMNS)


def fetch_gold_monitor_daily_features(settings: Settings) -> pd.DataFrame:
    return _fetch(settings, "gold_monitor_daily_features", GOLD_MONITOR_DAILY_FEATURES_COLUMNS)


def dataset_version(*frames: pd.DataFrame) -> str:
    """Deterministic fingerprint of the exact rows a run trained on — same
    approach as `volume.data.dataset_version`/`breach.data.dataset_version`."""
    digest = hashlib.sha256()
    for frame in frames:
        digest.update(pd.util.hash_pandas_object(frame, index=False).values.tobytes())
    return digest.hexdigest()[:16]
