from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

GOLD_ALERT_DAILY_FEATURES_COLUMNS = [
    "tenant_id",
    "date",
    "source",
    "total_incidents",
    "p1_count",
    "p2_count",
    "p3_count",
    "avg_opened_hour",
]


def fetch_gold_alert_daily_features(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(GOLD_ALERT_DAILY_FEATURES_COLUMNS)
    rows = client.execute(
        f"select {columns} from gold_alert_daily_features order by tenant_id, date"
    )
    return pd.DataFrame(rows, columns=GOLD_ALERT_DAILY_FEATURES_COLUMNS)


_VOLUME_FORECAST_DDL = """
CREATE TABLE IF NOT EXISTS gold_volume_forecast
(
    tenant_id       LowCardinality(String),
    target_date     Date,
    priority_group  LowCardinality(String),
    horizon         UInt8,
    yhat            Float64,
    yhat_lower      Float64,
    yhat_upper      Float64
)
ENGINE = MergeTree
ORDER BY (tenant_id, target_date, priority_group, horizon)
"""


def write_volume_forecast(settings: Settings, rows: list[dict]) -> None:
    """Persists this run's D+1/D+7 forecast — one row per tenant × target_date
    × priority_group × horizon — so the dashboard reads a queryable table
    instead of an MLflow run metric."""
    client = Client.from_url(settings.clickhouse_url)
    client.execute(_VOLUME_FORECAST_DDL)
    client.execute(
        "INSERT INTO gold_volume_forecast "
        "(tenant_id, target_date, priority_group, horizon, yhat, yhat_lower, yhat_upper) VALUES",
        rows,
    )


def dataset_version(daily: pd.DataFrame) -> str:
    """Deterministic fingerprint of the exact rows a run trained on — logged as
    an MLflow param so a run can be traced back to what the mart looked like
    at train time, without depending on an operator-supplied version string."""
    digest = hashlib.sha256(pd.util.hash_pandas_object(daily, index=False).values.tobytes())
    return digest.hexdigest()[:16]
