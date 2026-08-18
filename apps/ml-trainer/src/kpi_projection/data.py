from __future__ import annotations

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

KPI_MONTHLY_STATE_COLUMNS = ["month", "severity", "source", "total", "in_kpi", "breached"]


def fetch_kpi_monthly_state(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(KPI_MONTHLY_STATE_COLUMNS)
    rows = client.execute(f"select {columns} from kpi_monthly_state order by month, severity")
    return pd.DataFrame(rows, columns=KPI_MONTHLY_STATE_COLUMNS)
