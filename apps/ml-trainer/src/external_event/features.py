from __future__ import annotations

import pandas as pd

FEATURE_COLUMNS = [
    "total_signals",
    "p1_share",
    "critical_share",
    "unique_entities",
    "signals_per_entity",
    "cleared_share",
]


def to_daily_frame(daily: pd.DataFrame) -> pd.DataFrame:
    """Collapses per-(date, source) `gold_monitor_daily_features` rows into
    one row per date. `p1_share`/`critical_share` are averaged across
    sources — the mart has no per-source numerators for those to
    reconstruct from — but `signals_per_entity`/`cleared_share` are
    recomputed from the summed raw counts instead, since those numerators
    (`firing_count`/`cleared_count`/`unique_entities`) are additive."""
    daily = daily.copy()
    daily["date"] = pd.to_datetime(daily["date"])
    agg = (
        daily.groupby("date", as_index=False)
        .agg(
            total_signals=("total_signals", "sum"),
            firing_count=("firing_count", "sum"),
            cleared_count=("cleared_count", "sum"),
            p1_share=("p1_share", "mean"),
            critical_share=("critical_share", "mean"),
            unique_entities=("unique_entities", "sum"),
        )
        .sort_values("date")
        .reset_index(drop=True)
    )
    agg["signals_per_entity"] = agg["total_signals"] / agg["unique_entities"]
    agg["cleared_share"] = agg["cleared_count"] / agg["total_signals"]
    return agg
