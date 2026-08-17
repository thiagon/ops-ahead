from __future__ import annotations

from collections.abc import Sequence

import pandas as pd

from src.volume import features


def recursive_lgb_forecast(
    lgb_model,
    history_counts: pd.Series,
    priority_group: str,
    avg_opened_hour: float,
    target_dates: Sequence[pd.Timestamp],
) -> list[float]:
    """Point forecast for each of `target_dates` (consecutive future days) for
    one `priority_group`, using only the horizon=1 LightGBM model — the
    bundled `VolumeForecastModel` has no model for horizons between 2 and 6,
    so a Monte Carlo run covering an arbitrary number of remaining days in
    the month has to fall back to standard recursive multi-step forecasting:
    each day's own forecast is fed back as if it were the actual observed
    count when computing the next day's lag/rolling features.

    `history_counts` must be a date-indexed Series of real daily counts,
    sorted ascending, with at least 30 trailing days ending the day before
    `target_dates[0]`. `avg_opened_hour` is held constant across the horizon
    — a stable seasonal feature, not something a day-ahead recursion can
    predict on its own.
    """
    counts = history_counts.copy()
    forecasts: list[float] = []

    for target_date in target_dates:
        lag_1 = float(counts.iloc[-1])
        lag_7 = float(counts.iloc[-7]) if len(counts) >= 7 else float(counts.mean())
        lag_14 = float(counts.iloc[-14]) if len(counts) >= 14 else float(counts.mean())
        roll_mean_7 = float(counts.iloc[-7:].mean())
        roll_mean_30 = float(counts.iloc[-30:].mean())

        row = pd.DataFrame(
            [
                {
                    "priority_group": priority_group,
                    "avg_opened_hour": avg_opened_hour,
                    "lag_1": lag_1,
                    "lag_7": lag_7,
                    "lag_14": lag_14,
                    "roll_mean_7": roll_mean_7,
                    "roll_mean_30": roll_mean_30,
                    "target_date": target_date,
                }
            ]
        )
        row = features.add_fourier_features(row, date_column="target_date")
        row = features.add_holiday_flag(row, date_column="target_date")

        x = row[features.FEATURE_COLUMNS].copy()
        x["priority_group"] = x["priority_group"].astype("category")

        yhat = max(float(lgb_model.predict(x)[0]), 0.0)
        forecasts.append(yhat)
        counts.loc[target_date] = yhat

    return forecasts
