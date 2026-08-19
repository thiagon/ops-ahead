from __future__ import annotations

import pandas as pd

FEATURE_COLUMNS = [
    "total_incidents",
    "p1_share",
    "manual_open_share",
    "unique_entities",
    "no_intervention_share",
]


def to_daily_frame(daily: pd.DataFrame) -> pd.DataFrame:
    """Collapses per-(date, source) `daily_anomaly_features` rows into one
    row per date. Shares are averaged across sources, same simplification
    `volume.features.to_long_format` uses for `avg_opened_hour` — the mart
    has no per-source numerators for the share columns to reconstruct from."""
    daily = daily.copy()
    daily["date"] = pd.to_datetime(daily["date"])
    return (
        daily.groupby("date", as_index=False)
        .agg(
            total_incidents=("total_incidents", "sum"),
            p1_share=("p1_share", "mean"),
            manual_open_share=("manual_open_share", "mean"),
            no_intervention_share=("no_intervention_share", "mean"),
            unique_entities=("unique_entities", "sum"),
        )
        .sort_values("date")
        .reset_index(drop=True)
    )
