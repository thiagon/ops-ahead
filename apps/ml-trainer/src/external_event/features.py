from __future__ import annotations

import pandas as pd

FEATURE_COLUMNS = [
    "total_incidents",
    "p1_share",
    "manual_open_share",
    "unique_entities",
    "sem_intervencao_share",
]


def to_daily_frame(daily: pd.DataFrame) -> pd.DataFrame:
    """Collapses per-(date, source) `daily_anomaly_features` rows into one
    row per date — the grain the Isolation Forest reasons about ("was this
    day anomalous"), not per-source. Shares are averaged across sources
    (same simplification `volume.features.to_long_format` uses for
    `avg_opened_hour`) rather than reconstructed from raw counts — the mart
    doesn't carry per-source numerators for `manual_open_share`/
    `sem_intervencao_share`, and the dataset today has a single source
    anyway.
    """
    daily = daily.copy()
    daily["date"] = pd.to_datetime(daily["date"])
    return (
        daily.groupby("date", as_index=False)
        .agg(
            total_incidents=("total_incidents", "sum"),
            p1_share=("p1_share", "mean"),
            manual_open_share=("manual_open_share", "mean"),
            sem_intervencao_share=("sem_intervencao_share", "mean"),
            unique_entities=("unique_entities", "sum"),
        )
        .sort_values("date")
        .reset_index(drop=True)
    )
