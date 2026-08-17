import pandas as pd

from src.kpi_projection.forecast import recursive_lgb_forecast


class _EchoLag1Model:
    """Stub that returns lag_1 * 2 — deterministic and cheap, but enough to
    prove the recursion feeds each day's own forecast back as the next day's
    lag_1 (if it didn't, every day's forecast would echo the same real
    history value instead of compounding)."""

    def predict(self, x: pd.DataFrame):
        return (x["lag_1"] * 2).to_numpy()


def test_recursion_feeds_forecast_forward_as_next_lag_1():
    history = pd.Series(
        [1.0] * 30,
        index=pd.date_range("2026-01-01", periods=30, freq="D"),
    )
    target_dates = list(pd.date_range("2026-01-31", periods=3, freq="D"))

    forecasts = recursive_lgb_forecast(_EchoLag1Model(), history, "p2", avg_opened_hour=12.0, target_dates=target_dates)

    # day 1: lag_1 = 1.0 (real history) -> 2.0
    # day 2: lag_1 = 2.0 (day 1's own forecast) -> 4.0
    # day 3: lag_1 = 4.0 (day 2's own forecast) -> 8.0
    assert forecasts == [2.0, 4.0, 8.0]


def test_forecast_never_negative():
    class _NegativeModel:
        def predict(self, x: pd.DataFrame):
            return [-5.0] * len(x)

    history = pd.Series([3.0] * 30, index=pd.date_range("2026-01-01", periods=30, freq="D"))
    target_dates = list(pd.date_range("2026-01-31", periods=2, freq="D"))

    forecasts = recursive_lgb_forecast(_NegativeModel(), history, "p2", avg_opened_hour=12.0, target_dates=target_dates)

    assert forecasts == [0.0, 0.0]


def test_empty_target_dates_returns_empty_list():
    history = pd.Series([3.0] * 30, index=pd.date_range("2026-01-01", periods=30, freq="D"))

    forecasts = recursive_lgb_forecast(_EchoLag1Model(), history, "p2", avg_opened_hour=12.0, target_dates=[])

    assert forecasts == []
