from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

GOLD_ALERT_CATEGORY_TRENDS_COLUMNS = [
    "tenant_id",
    "date",
    "category",
    "product",
    "total_incidents",
]


def fetch_gold_alert_category_trends(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(GOLD_ALERT_CATEGORY_TRENDS_COLUMNS)
    rows = client.execute(
        f"select {columns} from gold_alert_category_trends order by tenant_id, category, product, date"
    )
    return pd.DataFrame(rows, columns=GOLD_ALERT_CATEGORY_TRENDS_COLUMNS)


_ENTITY_FORECAST_DDL = """
CREATE TABLE IF NOT EXISTS gold_entity_forecast
(
    tenant_id       LowCardinality(String),
    target_date     Date,
    category        String,
    product         String,
    horizon         UInt8,
    yhat            Float64,
    yhat_lower      Float64,
    yhat_upper      Float64
)
ENGINE = MergeTree
ORDER BY (tenant_id, target_date, category, product, horizon)
"""


def write_entity_forecast(settings: Settings, rows: list[dict]) -> None:
    """One row per tenant × target_date × category × product × horizon — the
    grain the dashboard answers "which products need attention" from."""
    client = Client.from_url(settings.clickhouse_url)
    client.execute(_ENTITY_FORECAST_DDL)
    client.execute(
        "INSERT INTO gold_entity_forecast "
        "(tenant_id, target_date, category, product, horizon, yhat, yhat_lower, yhat_upper) VALUES",
        rows,
    )


def dataset_version(trends: pd.DataFrame) -> str:
    """Deterministic fingerprint of the rows a run trained on — see
    volume.data.dataset_version."""
    digest = hashlib.sha256(pd.util.hash_pandas_object(trends, index=False).values.tobytes())
    return digest.hexdigest()[:16]
