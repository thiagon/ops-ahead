from __future__ import annotations

import pandas as pd

# One row per day, describing that day from both intakes. The alert side is
# always present; the monitor side only exists where an origin observes
# conditions, which most tenants have none of — so it is folded in rather than
# required, and an absent day is zero signals, not a missing measurement.
# Prefixes are what keep the two apart: `unique_entities` and `critical_share`
# mean different things on each side and both marts publish them.
ALERT_FEATURE_COLUMNS = [
    "alert_total_incidents",
    "alert_incidents_per_entity",
    "alert_unique_entities",
    "alert_critical_share",
    "alert_manual_open_share",
]

MONITOR_FEATURE_COLUMNS = [
    "monitor_total_signals",
    "monitor_signals_per_entity",
    "monitor_unique_entities",
    "monitor_p1_share",
    "monitor_critical_share",
    "monitor_cleared_share",
]

FEATURE_COLUMNS = [*ALERT_FEATURE_COLUMNS, *MONITOR_FEATURE_COLUMNS]


def to_alert_daily_frame(daily: pd.DataFrame) -> pd.DataFrame:
    """Collapses per-(date, source) `gold_alert_daily_features` rows into one
    row per date. Counts are additive and summed; the share columns are
    averaged across sources, the mart having no per-source numerators for
    them, and `incidents_per_entity` is recomputed from the sums instead."""
    daily = daily.copy()
    daily["date"] = pd.to_datetime(daily["date"])
    agg = (
        daily.groupby("date", as_index=False)
        .agg(
            alert_total_incidents=("total_incidents", "sum"),
            alert_unique_entities=("unique_entities", "sum"),
            alert_critical_share=("critical_share", "mean"),
            alert_manual_open_share=("manual_open_share", "mean"),
        )
        .sort_values("date")
        .reset_index(drop=True)
    )
    agg["alert_incidents_per_entity"] = agg["alert_total_incidents"] / agg["alert_unique_entities"]
    return agg


def to_monitor_daily_frame(daily: pd.DataFrame) -> pd.DataFrame:
    """Same collapse for `gold_monitor_daily_features`. `p1_share`/
    `critical_share` are averaged across sources — the mart has no per-source
    numerators for those to reconstruct from — but `signals_per_entity`/
    `cleared_share` are recomputed from the summed raw counts instead, since
    those numerators (`firing_count`/`cleared_count`/`unique_entities`) are
    additive."""
    daily = daily.copy()
    daily["date"] = pd.to_datetime(daily["date"])
    agg = (
        daily.groupby("date", as_index=False)
        .agg(
            monitor_total_signals=("total_signals", "sum"),
            monitor_firing_count=("firing_count", "sum"),
            monitor_cleared_count=("cleared_count", "sum"),
            monitor_p1_share=("p1_share", "mean"),
            monitor_critical_share=("critical_share", "mean"),
            monitor_unique_entities=("unique_entities", "sum"),
        )
        .sort_values("date")
        .reset_index(drop=True)
    )
    agg["monitor_signals_per_entity"] = (
        agg["monitor_total_signals"] / agg["monitor_unique_entities"]
    )
    agg["monitor_cleared_share"] = agg["monitor_cleared_count"] / agg["monitor_total_signals"]
    return agg


def to_daily_frame(alert: pd.DataFrame, monitor: pd.DataFrame | None = None) -> pd.DataFrame:
    """The frame the detector trains on: the alert chain's day, widened with
    the monitor chain's where one exists."""
    frame = to_alert_daily_frame(alert)

    if monitor is None or monitor.empty:
        for column in MONITOR_FEATURE_COLUMNS:
            frame[column] = 0.0
        return frame

    frame = frame.merge(to_monitor_daily_frame(monitor), on="date", how="left")
    # A day the monitor chain never reported observed no condition; that is a
    # measured zero, and a ratio over zero signals is zero too, not undefined.
    for column in MONITOR_FEATURE_COLUMNS:
        frame[column] = frame[column].fillna(0.0)
    return frame.replace([float("inf"), float("-inf")], 0.0)
