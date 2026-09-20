from __future__ import annotations

import pandas as pd

from volume import features as volume_features

# The series key inside one tenant. Training is per tenant (see train.py), so
# the tenant is the frame, never part of the key. `volume.features` builds
# lags, targets and calendar columns grouped by a column literally named
# `priority_group`, so the series is renamed into that name rather than
# duplicating the window logic here.
SERIES_COLUMNS = ["category", "product"]

RESIDUAL_LABEL = "__other__"

FEATURE_COLUMNS = [
    "priority_group",
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


def series_key(row: pd.Series) -> str:
    return "|".join(str(row[column]) for column in SERIES_COLUMNS)


def to_long_format(trends: pd.DataFrame, min_history_days: int) -> pd.DataFrame:
    """One row per (date, series) for a single tenant's rows, where a series is
    category×product.

    Combinations below `min_history_days` are summed into one residual series
    instead of being dropped: most of the volume lives in the tail, and a
    forecast whose parts do not add up to the whole is not usable.
    """
    df = trends.copy()
    df["date"] = pd.to_datetime(df["date"])
    df["series"] = df.apply(series_key, axis=1)

    history = df.groupby("series")["date"].nunique()
    sparse = set(history[history < min_history_days].index)

    df["priority_group"] = df["series"].where(
        ~df["series"].isin(sparse),
        RESIDUAL_LABEL + "|" + RESIDUAL_LABEL,
    )

    collapsed = (
        df.groupby(["priority_group", "date"], as_index=False)
        .agg(count=("total_incidents", "sum"))
        .sort_values(["priority_group", "date"])
        .reset_index(drop=True)
    )
    return _fill_calendar_gaps(collapsed)


def _fill_calendar_gaps(long_df: pd.DataFrame) -> pd.DataFrame:
    """A day a series recorded nothing is a zero, not a missing value.

    Sparse products only appear on the days they had an incident, so their
    rolling windows would never fill and the residual series would drop out of
    the feature frame entirely — its volume vanishing from the forecast
    instead of being carried thin.
    """
    if long_df.empty:
        return long_df

    calendar = pd.date_range(long_df["date"].min(), long_df["date"].max(), freq="D")
    index = pd.MultiIndex.from_product(
        [long_df["priority_group"].unique(), calendar], names=["priority_group", "date"]
    )
    return (
        long_df.set_index(["priority_group", "date"])
        .reindex(index, fill_value=0)
        .reset_index()
        .sort_values(["priority_group", "date"])
        .reset_index(drop=True)
    )


def build_feature_frame(trends: pd.DataFrame, horizon: int, min_history_days: int) -> pd.DataFrame:
    """Same construction volume uses, over the category×product series. The
    calendar features describe the day being forecast, the lags only the past —
    see volume.features.build_feature_frame."""
    long_df = to_long_format(trends, min_history_days)
    featured = volume_features.add_lag_features(long_df)
    featured = volume_features.add_target(featured, horizon)
    featured["target_date"] = featured["date"] + pd.Timedelta(days=horizon)
    featured = volume_features.add_fourier_features(featured, date_column="target_date")
    featured = volume_features.add_holiday_flag(featured, date_column="target_date")

    target_column = f"target_d{horizon}"
    required = FEATURE_COLUMNS + [target_column, "date"]
    return featured.dropna(
        subset=[c for c in required if c != "priority_group"]
    ).reset_index(drop=True)
