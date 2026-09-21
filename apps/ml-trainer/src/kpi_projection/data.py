from __future__ import annotations

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

KPI_MONTHLY_STATE_COLUMNS = ["tenant_id", "month", "severity", "source", "total", "in_kpi", "breached"]
KPI_ACHIEVEMENT_COLUMNS = ["tenant_id", "year", "month", "severities", "breached_in_month", "breached_ytd"]
KPI_TARGETS_COLUMNS = ["tenant_id", "severities", "max_breaches", "achievement_pct"]


def _hashable_bands(frame: pd.DataFrame) -> pd.DataFrame:
    """Array(UInt8) arrives as a list, which cannot key a groupby or a dict.
    The band is the identity of every projection row, so it is normalised to a
    tuple at the edge instead of at each use."""
    if not frame.empty:
        frame["severities"] = frame["severities"].map(tuple)
    return frame


def fetch_kpi_monthly_state(settings: Settings) -> pd.DataFrame:
    """Eligibility signal only — how much of the month's volume counted in
    KPI, per severity. The breach-count target itself comes from
    gold_alert_kpi_achievement; this mart is unrelated to that band."""
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(KPI_MONTHLY_STATE_COLUMNS)
    rows = client.execute(f"select {columns} from kpi_monthly_state order by tenant_id, month, severity")
    return pd.DataFrame(rows, columns=KPI_MONTHLY_STATE_COLUMNS)


def fetch_kpi_achievement(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(KPI_ACHIEVEMENT_COLUMNS)
    rows = client.execute(
        f"select {columns} from gold_alert_kpi_achievement order by tenant_id, severities, year, month"
    )
    return _hashable_bands(pd.DataFrame(rows, columns=KPI_ACHIEVEMENT_COLUMNS))


def fetch_kpi_targets(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(KPI_TARGETS_COLUMNS)
    rows = client.execute(
        f"select {columns} from tenant_kpi_targets final order by tenant_id, severities, max_breaches"
    )
    return _hashable_bands(pd.DataFrame(rows, columns=KPI_TARGETS_COLUMNS))


_KPI_PROJECTION_DDL = """
CREATE TABLE IF NOT EXISTS gold_kpi_projection
(
    tenant_id            LowCardinality(String),
    as_of_date           Date,
    severities           Array(UInt8),
    median_breaches_ytd  Float64,
    ci80_lower           Float64,
    ci80_upper           Float64,
    p_within_target      Nullable(Float64)
)
ENGINE = MergeTree
ORDER BY (tenant_id, severities, as_of_date)
"""


def write_kpi_projection(settings: Settings, rows: list[dict]) -> None:
    """Persists this run's projection — one row per tenant_id × as_of_date ×
    severities — so the dashboard reads a queryable table instead of an
    MLflow run metric. The band is stored as the severities themselves; the
    label on the axis is the front's to format."""
    client = Client.from_url(settings.clickhouse_url)
    client.execute(_KPI_PROJECTION_DDL)
    client.execute(
        "INSERT INTO gold_kpi_projection "
        "(tenant_id, as_of_date, severities, median_breaches_ytd, ci80_lower, ci80_upper, p_within_target) VALUES",
        rows,
    )
