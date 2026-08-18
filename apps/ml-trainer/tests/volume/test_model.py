import numpy as np
import pandas as pd
import pytest

from settings import Settings
from volume.features import to_long_format
from volume.model import VolumeForecastModel
from volume.train import train_horizon


def _synthetic_daily(days: int = 240) -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=days, freq="D")
    rng = np.random.default_rng(7)
    rows = []
    for date in dates:
        weekday_factor = 0.6 if date.dayofweek >= 5 else 1.0
        total = max(int((25 + 5 * np.sin(date.dayofyear / 30)) * weekday_factor + rng.integers(-2, 3)), 5)
        rows.append(
            {
                "date": date,
                "source": "itsm",
                "total_incidents": total,
                "p1_count": max(total // 12, 0),
                "p2_count": max(total // 6, 0),
                "p3_count": max(total // 3, 0),
                "avg_opened_hour": 12.0 + rng.integers(-1, 2),
            }
        )
    return pd.DataFrame(rows)


@pytest.fixture
def bundled_model() -> VolumeForecastModel:
    settings = Settings(
        train_end="2025-06-30",
        validation_end="2025-07-31",
        holdout_end="2025-08-31",
    )
    daily = _synthetic_daily()
    long_df = to_long_format(daily)
    result = train_horizon(daily, long_df, settings, horizon=1)
    return VolumeForecastModel(
        lgb_models={1: result["lgb_model"]},
        prophet_models={1: result["prophet_models"]},
        ensemble_weights={1: result["weight"]},
    )


def test_predict_accepts_timezone_naive_date(bundled_model):
    model_input = pd.DataFrame(
        [
            {
                "priority_group": "total",
                "date": "2025-06-01",
                "avg_opened_hour": 12.0,
                "lag_1": 20,
                "lag_7": 18,
                "lag_14": 22,
                "roll_mean_7": 19.5,
                "roll_mean_30": 20.1,
            }
        ]
    )

    result = bundled_model.predict(None, model_input)

    assert len(result) == 1
    assert result.iloc[0]["yhat"] >= 0


def test_predict_accepts_timezone_aware_date(bundled_model):
    # The HTTP API (ml-model-serving) accepts ISO 8601 with a Z/offset,
    # which parses to a tz-aware Timestamp — Prophet rejects a tz-aware
    # "ds" column outright if it isn't stripped first.
    model_input = pd.DataFrame(
        [
            {
                "priority_group": "total",
                "date": "2025-06-01T00:00:00Z",
                "avg_opened_hour": 12.0,
                "lag_1": 20,
                "lag_7": 18,
                "lag_14": 22,
                "roll_mean_7": 19.5,
                "roll_mean_30": 20.1,
            }
        ]
    )

    result = bundled_model.predict(None, model_input)

    assert len(result) == 1
    assert result.iloc[0]["yhat"] >= 0
