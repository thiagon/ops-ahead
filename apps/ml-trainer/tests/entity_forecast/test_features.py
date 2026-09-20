from __future__ import annotations

import pandas as pd
import pytest

from entity_forecast import features


def _trends(series: dict[tuple[str, str], int], start: str = "2026-01-01") -> pd.DataFrame:
    """One row per (category, product) per day, `days` days long each."""
    rows = []
    for (category, product), days in series.items():
        for offset in range(days):
            rows.append(
                {
                    "tenant_id": "locaweb",
                    "date": pd.Timestamp(start) + pd.Timedelta(days=offset),
                    "category": category,
                    "product": product,
                    "total_incidents": 10 + offset % 5,
                }
            )
    return pd.DataFrame(rows)


def test_each_category_product_pair_is_its_own_series():
    long_df = features.to_long_format(
        _trends({("cat1", "prodA"): 90, ("cat2", "prodB"): 90}), min_history_days=60
    )

    assert set(long_df["priority_group"]) == {
        "locaweb|cat1|prodA",
        "locaweb|cat2|prodB",
    }


def test_a_thin_series_is_folded_into_the_residual_rather_than_dropped():
    trends = _trends({("cat1", "prodA"): 90, ("cat2", "prodB"): 10})

    long_df = features.to_long_format(trends, min_history_days=60)

    groups = set(long_df["priority_group"])
    assert "locaweb|cat2|prodB" not in groups
    assert f"locaweb|{features.RESIDUAL_LABEL}|{features.RESIDUAL_LABEL}" in groups
    # Nothing leaves the total: a forecast whose parts do not add up to the
    # whole cannot be reconciled with volume_forecast.
    assert long_df["count"].sum() == trends["total_incidents"].sum()


def test_residual_is_per_tenant_so_clients_are_never_summed_together():
    trends = pd.concat(
        [
            _trends({("cat1", "prodA"): 5}),
            _trends({("cat1", "prodA"): 5}).assign(tenant_id="acme"),
        ]
    )

    long_df = features.to_long_format(trends, min_history_days=60)

    residuals = {g for g in long_df["priority_group"] if features.RESIDUAL_LABEL in g}
    assert residuals == {
        f"locaweb|{features.RESIDUAL_LABEL}|{features.RESIDUAL_LABEL}",
        f"acme|{features.RESIDUAL_LABEL}|{features.RESIDUAL_LABEL}",
    }


def test_feature_frame_targets_the_forecast_day_not_the_feature_day():
    frame = features.build_feature_frame(
        _trends({("cat1", "prodA"): 120}), horizon=7, min_history_days=60
    )

    assert not frame.empty
    assert (frame["target_date"] - frame["date"] == pd.Timedelta(days=7)).all()


@pytest.mark.parametrize("horizon", [1, 7])
def test_rows_without_a_full_lag_window_or_a_target_are_dropped(horizon):
    frame = features.build_feature_frame(
        _trends({("cat1", "prodA"): 120}), horizon=horizon, min_history_days=60
    )

    assert frame[f"target_d{horizon}"].notna().all()
    assert frame["roll_mean_30"].notna().all()
