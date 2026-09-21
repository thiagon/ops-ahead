from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

GOLD_ALERT_CATEGORY_ENTITY_BREAKDOWN_COLUMNS = [
    "tenant_id",
    "date",
    "category",
    "product",
    "entity_id",
    "severity",
    "incident_count",
    "breached",
    "avg_duration_seconds",
]


def fetch_gold_alert_category_entity_breakdown(settings: Settings, days_back: int) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(GOLD_ALERT_CATEGORY_ENTITY_BREAKDOWN_COLUMNS)
    rows = client.execute(
        f"select {columns} from gold_alert_category_entity_breakdown "
        f"where date >= today() - {int(days_back)} "
        "order by tenant_id, entity_id, date"
    )
    return pd.DataFrame(rows, columns=GOLD_ALERT_CATEGORY_ENTITY_BREAKDOWN_COLUMNS)


_RECURRING_CAUSES_DDL = """
CREATE TABLE IF NOT EXISTS gold_recurring_causes
(
    tenant_id     LowCardinality(String),
    as_of_date    Date,
    entity_id     String,
    group_id      UInt16,
    category      String,
    product       String,
    incident_count UInt32
)
ENGINE = MergeTree
ORDER BY (tenant_id, as_of_date, entity_id)
"""

_RECURRING_CAUSE_GROUPS_DDL = """
CREATE TABLE IF NOT EXISTS gold_recurring_cause_groups
(
    tenant_id     LowCardinality(String),
    as_of_date    Date,
    group_id      UInt16,
    entity_count  UInt32,
    silhouette    Float64,
    distinguishing_features String,
    top_products  String
)
ENGINE = MergeTree
ORDER BY (tenant_id, as_of_date, group_id)
"""


def write_recurring_causes(settings: Settings, members: list[dict], groups: list[dict]) -> None:
    """Two grains, one per question: which group an entity fell in, and what
    distinguishes each group. The dashboard reads ClickHouse, so the result is
    a table — the model stays in MLflow to compare one run against the last."""
    client = Client.from_url(settings.clickhouse_url)
    client.execute(_RECURRING_CAUSES_DDL)
    client.execute(_RECURRING_CAUSE_GROUPS_DDL)
    if members:
        client.execute(
            "INSERT INTO gold_recurring_causes "
            "(tenant_id, as_of_date, entity_id, group_id, category, product, incident_count) VALUES",
            members,
        )
    if groups:
        client.execute(
            "INSERT INTO gold_recurring_cause_groups "
            "(tenant_id, as_of_date, group_id, entity_count, silhouette, "
            "distinguishing_features, top_products) VALUES",
            groups,
        )


def dataset_version(breakdown: pd.DataFrame) -> str:
    """Deterministic fingerprint of the rows a run grouped over — see
    volume.data.dataset_version."""
    digest = hashlib.sha256(pd.util.hash_pandas_object(breakdown, index=False).values.tobytes())
    return digest.hexdigest()[:16]
