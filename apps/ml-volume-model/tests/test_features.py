import numpy as np
import pandas as pd

from src.features import (
    add_fourier_features,
    add_holiday_flag,
    add_lag_features,
    add_target,
    build_feature_frame,
    to_long_format,
)


def _synthetic_daily(days: int = 60) -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=days, freq="D")
    rng = np.random.default_rng(42)
    rows = []
    for source in ("itsm", "alertmanager"):
        for i, date in enumerate(dates):
            total = 20 + i % 7 + int(rng.integers(0, 3))
            rows.append(
                {
                    "date": date,
                    "source": source,
                    "total_incidents": total,
                    "p1_count": max(total // 10, 0),
                    "p2_count": max(total // 5, 0),
                    "p3_count": max(total // 3, 0),
                    "avg_opened_hour": 12.0,
                }
            )
    return pd.DataFrame(rows)


def test_to_long_format_sums_across_sources():
    daily = _synthetic_daily(days=5)
    long_df = to_long_format(daily)

    assert set(long_df["priority_group"]) == {"total", "p1", "p2", "p3"}

    day0 = pd.Timestamp("2025-01-01")
    expected_total = daily.loc[daily["date"] == day0, "total_incidents"].sum()
    actual_total = long_df.loc[
        (long_df["date"] == day0) & (long_df["priority_group"] == "total"), "count"
    ].item()
    assert actual_total == expected_total


def test_lag_features_do_not_leak_future_values():
    daily = _synthetic_daily(days=30)
    long_df = to_long_format(daily)
    featured = add_lag_features(long_df)

    series = featured[featured["priority_group"] == "total"].sort_values("date").reset_index(drop=True)
    # lag_1 on day t must equal count on day t-1, never day t itself.
    for t in range(1, len(series)):
        assert series.loc[t, "lag_1"] == series.loc[t - 1, "count"]
    assert pd.isna(series.loc[0, "lag_1"])


def test_target_shifts_forward_not_backward():
    daily = _synthetic_daily(days=20)
    long_df = to_long_format(daily)
    targeted = add_target(long_df, horizon=1)

    series = targeted[targeted["priority_group"] == "p1"].sort_values("date").reset_index(drop=True)
    for t in range(len(series) - 1):
        assert series.loc[t, "target_d1"] == series.loc[t + 1, "count"]
    assert pd.isna(series.loc[len(series) - 1, "target_d1"])


def test_fourier_features_are_bounded():
    daily = _synthetic_daily(days=10)
    long_df = to_long_format(daily)
    featured = add_fourier_features(long_df)

    for col in ("fourier_sin_1", "fourier_cos_1", "fourier_sin_2", "fourier_cos_2"):
        assert featured[col].between(-1.0, 1.0).all()


def test_holiday_flag_marks_new_year():
    daily = _synthetic_daily(days=3)  # starts 2025-01-01
    long_df = to_long_format(daily)
    featured = add_holiday_flag(long_df)

    new_year_rows = featured[featured["date"] == pd.Timestamp("2025-01-01")]
    assert (new_year_rows["is_national_holiday"] == 1).all()


def test_build_feature_frame_has_no_nulls_in_features_or_target():
    daily = _synthetic_daily(days=60)
    frame = build_feature_frame(daily, horizon=7)

    feature_and_target_cols = [
        "lag_1",
        "lag_7",
        "lag_14",
        "roll_mean_7",
        "roll_mean_30",
        "target_d7",
    ]
    assert not frame.empty
    assert not frame[feature_and_target_cols].isna().any().any()


def test_build_feature_frame_calendar_features_describe_target_day_not_feature_day():
    daily = _synthetic_daily(days=60)
    horizon = 7
    frame = build_feature_frame(daily, horizon=horizon)

    row = frame[frame["priority_group"] == "total"].iloc[0]
    expected_target_date = row["date"] + pd.Timedelta(days=horizon)
    expected_dow = expected_target_date.dayofweek
    assert row["fourier_sin_1"] == np.sin(2 * np.pi * 1 * expected_dow / 7)
    assert row["fourier_cos_1"] == np.cos(2 * np.pi * 1 * expected_dow / 7)


def test_build_feature_frame_drops_incomplete_lag_window_and_missing_target():
    daily = _synthetic_daily(days=60)
    long_df = to_long_format(daily)
    n_series_days = len(long_df[long_df["priority_group"] == "total"])

    frame = build_feature_frame(daily, horizon=1)
    n_frame_days = len(frame[frame["priority_group"] == "total"])

    # roll_mean_30 needs 30 prior days, so at least the first 30 rows drop;
    # horizon=1 drops exactly the last row too.
    assert n_frame_days <= n_series_days - 30
