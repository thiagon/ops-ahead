from __future__ import annotations

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

KPI_MONTHLY_STATE_COLUMNS = ["month", "severity", "source", "total", "in_kpi", "breached"]
KPI_ACHIEVEMENT_COLUMNS = ["tenant_id", "year", "month", "kpi_group", "breached_in_month", "breached_ytd"]
KPI_TARGETS_COLUMNS = ["tenant_id", "kpi_group", "max_breaches", "achievement_pct"]


def fetch_kpi_monthly_state(settings: Settings) -> pd.DataFrame:
    """Eligibility signal only — how much of the month's volume counted in
    KPI, per severity. The breach-count target itself comes from
    gold_alert_kpi_achievement; this mart is unrelated to that band."""
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(KPI_MONTHLY_STATE_COLUMNS)
    rows = client.execute(f"select {columns} from kpi_monthly_state order by month, severity")
    return pd.DataFrame(rows, columns=KPI_MONTHLY_STATE_COLUMNS)


def fetch_kpi_achievement(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(KPI_ACHIEVEMENT_COLUMNS)
    rows = client.execute(
        f"select {columns} from gold_alert_kpi_achievement order by tenant_id, kpi_group, year, month"
    )
    return pd.DataFrame(rows, columns=KPI_ACHIEVEMENT_COLUMNS)


def fetch_kpi_targets(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(KPI_TARGETS_COLUMNS)
    rows = client.execute(f"select {columns} from tenant_kpi_targets order by tenant_id, kpi_group, max_breaches")
    return pd.DataFrame(rows, columns=KPI_TARGETS_COLUMNS)


_KPI_PROJECTION_DDL = """
CREATE TABLE IF NOT EXISTS gold_kpi_projection
(
    tenant_id            LowCardinality(String),
    as_of_date           Date,
    kpi_group            LowCardinality(String),
    median_breaches_ytd  Float64,
    ci80_lower           Float64,
    ci80_upper           Float64,
    p_within_target      Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (tenant_id, kpi_group, as_of_date)
"""


def write_kpi_projection(settings: Settings, rows: list[dict]) -> None:
    """Persists this run's projection — one row per tenant_id × as_of_date ×
    kpi_group — so the dashboard reads a queryable table instead of an
    MLflow run metric."""
    client = Client.from_url(settings.clickhouse_url)
    client.execute(_KPI_PROJECTION_DDL)
    client.execute(
        "INSERT INTO gold_kpi_projection "
        "(tenant_id, as_of_date, kpi_group, median_breaches_ytd, ci80_lower, ci80_upper, p_within_target) VALUES",
        rows,
    )
