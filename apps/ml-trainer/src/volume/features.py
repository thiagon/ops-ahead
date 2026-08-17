from __future__ import annotations

import holidays
import numpy as np
import pandas as pd

BR_HOLIDAYS = holidays.Brazil()

PRIORITY_GROUPS = {
    "total": "total_incidents",
    "p1": "p1_count",
    "p2": "p2_count",
    "p3": "p3_count",
}


def to_long_format(daily: pd.DataFrame) -> pd.DataFrame:
    """Collapse `daily_anomaly_features` (one row per date × source) into one
    row per (date, priority_group), summing across sources. `priority_group`
    lets a single model learn the shared weekly/seasonal pattern across
    series while `MAPE` is still reported apart per group."""
    daily = daily.copy()
    daily["date"] = pd.to_datetime(daily["date"])

    agg = daily.groupby("date", as_index=False).agg(
        total_incidents=("total_incidents", "sum"),
        p1_count=("p1_count", "sum"),
        p2_count=("p2_count", "sum"),
        p3_count=("p3_count", "sum"),
        avg_opened_hour=("avg_opened_hour", "mean"),
    )

    frames = []
    for group_name, column in PRIORITY_GROUPS.items():
        frame = agg[["date", "avg_opened_hour"]].copy()
        frame["priority_group"] = group_name
        frame["count"] = agg[column]
        frames.append(frame)

    return (
        pd.concat(frames, ignore_index=True)
        .sort_values(["priority_group", "date"])
        .reset_index(drop=True)
    )


def add_lag_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["priority_group", "date"]).reset_index(drop=True).copy()
    by_series = df.groupby("priority_group")["count"]
    df["lag_1"] = by_series.shift(1)
    df["lag_7"] = by_series.shift(7)
    df["lag_14"] = by_series.shift(14)
    # shift(1) before rolling — the window must never include the current day.
    shifted = by_series.shift(1)
    df["roll_mean_7"] = shifted.groupby(df["priority_group"]).rolling(7).mean().reset_index(level=0, drop=True)
    df["roll_mean_30"] = shifted.groupby(df["priority_group"]).rolling(30).mean().reset_index(level=0, drop=True)
    return df


def add_fourier_features(
    df: pd.DataFrame, period: int = 7, order: int = 2, date_column: str = "date"
) -> pd.DataFrame:
    df = df.copy()
    day_of_week = df[date_column].dt.dayofweek
    for k in range(1, order + 1):
        df[f"fourier_sin_{k}"] = np.sin(2 * np.pi * k * day_of_week / period)
        df[f"fourier_cos_{k}"] = np.cos(2 * np.pi * k * day_of_week / period)
    return df


def add_holiday_flag(df: pd.DataFrame, date_column: str = "date") -> pd.DataFrame:
    df = df.copy()
    df["is_national_holiday"] = df[date_column].dt.date.apply(lambda d: d in BR_HOLIDAYS).astype(int)
    return df


def add_target(df: pd.DataFrame, horizon: int) -> pd.DataFrame:
    df = df.sort_values(["priority_group", "date"]).reset_index(drop=True).copy()
    target_column = f"target_d{horizon}"
    df[target_column] = df.groupby("priority_group")["count"].shift(-horizon)
    return df


FEATURE_COLUMNS = [
    "priority_group",
    "avg_opened_hour",
    "lag_1",
    "lag_7",
    "lag_14",
    "roll_mean_7",
    "roll_mean_30",
    "fourier_sin_1",
    "fourier_cos_1",
    "fourier_sin_2",
    "fourier_cos_2",
    "is_national_holiday",
]


def build_feature_frame(daily: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """Full pipeline from the raw `daily_anomaly_features` mart to a model-ready
    frame for a given forecast horizon (1 or 7 days). Rows without a full lag
    window (start of series) or without a future target (end of series) are
    dropped — both are structurally incomplete, not missing data to impute.

    Fourier/holiday features describe `target_date` (date + horizon) — the day
    being forecast — not the feature date `date`. Weekday and holiday status of
    the *target* day is what actually drives incident volume; the feature day's
    calendar position is only relevant through the lag/rolling values, which
    are computed from `date` on purpose since they must only see the past.
    """
    long_df = to_long_format(daily)
    featured = add_lag_features(long_df)
    featured = add_target(featured, horizon)
    featured["target_date"] = featured["date"] + pd.Timedelta(days=horizon)
    featured = add_fourier_features(featured, date_column="target_date")
    featured = add_holiday_flag(featured, date_column="target_date")

    target_column = f"target_d{horizon}"
    required = FEATURE_COLUMNS + [target_column, "date"]
    return featured.dropna(subset=[c for c in required if c != "priority_group"]).reset_index(drop=True)
