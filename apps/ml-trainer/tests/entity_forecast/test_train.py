from __future__ import annotations

import pandas as pd

from entity_forecast import features, train
from settings import Settings


def _trends(pairs: list[tuple[str, str]], days: int = 200) -> pd.DataFrame:
    rows = []
    for category, product in pairs:
        for offset in range(days):
            rows.append(
                {
                    "tenant_id": "locaweb",
                    "date": pd.Timestamp("2025-01-01") + pd.Timedelta(days=offset),
                    "category": category,
                    "product": product,
                    "total_incidents": 20 + (offset % 7) * 3,
                }
            )
    return pd.DataFrame(rows)


def _settings() -> Settings:
    return Settings(
        train_end="2025-04-30",
        validation_end="2025-05-31",
        holdout_end="2025-07-19",
        entity_min_history_days=60,
    )


def test_train_horizon_learns_the_weekly_shape_over_every_series():
    result = train.train_horizon(_trends([("cat1", "prodA"), ("cat2", "prodB")]), _settings(), 1)

    assert result["series_count"] == 2
    # A flat weekly pattern is easy; this only asserts the model is not wildly
    # off, which is what would happen if the series categories were misaligned.
    assert result["metrics"]["mae"] < 10


def test_forecast_rows_carry_the_series_back_as_its_own_columns():
    settings = _settings()
    trends = _trends([("cat1", "prodA"), ("cat2", "prodB")])
    results = {h: train.train_horizon(trends, settings, h) for h in train.HORIZONS}

    rows = train._forecast_rows(trends, settings, results)

    assert {row["category"] for row in rows} == {"cat1", "cat2"}
    assert {row["product"] for row in rows} == {"prodA", "prodB"}
    assert {row["tenant_id"] for row in rows} == {"locaweb"}
    assert {row["horizon"] for row in rows} == set(train.HORIZONS)
    assert all(row["yhat_lower"] <= row["yhat"] <= row["yhat_upper"] for row in rows)
    assert all(row["yhat_lower"] >= 0 for row in rows)


def test_a_thin_product_is_forecast_inside_the_residual_series():
    settings = _settings()
    trends = pd.concat([_trends([("cat1", "prodA")]), _trends([("cat9", "rare")], days=20)])
    results = {h: train.train_horizon(trends, settings, h) for h in train.HORIZONS}

    rows = train._forecast_rows(trends, settings, results)

    products = {row["product"] for row in rows}
    assert "rare" not in products
    assert features.RESIDUAL_LABEL in products
