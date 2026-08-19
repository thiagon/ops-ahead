import numpy as np
import pandas as pd
import pytest

from kpi_projection.run import run_kpi_projection
from settings import Settings


def _synthetic_daily(days: int = 75, start: str = "2025-01-01") -> pd.DataFrame:
    dates = pd.date_range(start, periods=days, freq="D")
    rng = np.random.default_rng(11)
    rows = []
    for date in dates:
        weekday_factor = 0.6 if date.dayofweek >= 5 else 1.0
        total = max(int((25 + 5 * np.sin(date.dayofyear / 30)) * weekday_factor + rng.integers(-2, 3)), 5)
        rows.append(
            {
                "date": date,
                "source": "itsm",
                "total_incidents": total,
                "p1_count": max(total // 12, 1),
                "p2_count": max(total // 6, 1),
                "p3_count": max(total // 3, 1),
                "avg_opened_hour": 12.0 + rng.integers(-1, 2),
            }
        )
    return pd.DataFrame(rows)


def _synthetic_kpi_state(month_start: pd.Timestamp) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"month": month_start, "severity": 2, "source": "itsm", "total": 200, "in_kpi": 180, "breached": 5},
            {"month": month_start, "severity": 3, "source": "itsm", "total": 400, "in_kpi": 380, "breached": 10},
        ]
    )


@pytest.fixture
def synthetic_settings(tmp_path) -> Settings:
    return Settings(
        clickhouse_url="clickhouse://default:@localhost:9000/default",
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="kpi-monthly-projection-test",
        dataset_version="test-fixture",
        kpi_projection_n_simulations=200,
        kpi_projection_seed=1,
        kpi_projection_holdout_days=10,
    )


def test_run_kpi_projection_produces_the_four_ppr_dimensions(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)

    result = run_kpi_projection(synthetic_settings, daily, kpi_state)

    assert result["run_id"]
    assert set(result["projections"].keys()) == {"volume_p2", "volume_p3", "ola_p2", "ola_p3"}
    for summary in result["projections"].values():
        assert summary.ci80_lower <= summary.median <= summary.ci80_upper
        assert summary.p_within_target is None  # no target configured in the fixture


def test_run_kpi_projection_reports_probability_when_target_configured(synthetic_settings):
    synthetic_settings.kpi_target_volume_p2 = 100_000  # generous target, near-certain to be met
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)

    result = run_kpi_projection(synthetic_settings, daily, kpi_state)

    assert result["projections"]["volume_p2"].p_within_target == pytest.approx(1.0)


def test_same_seed_reproduces_same_medians(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)

    result_a = run_kpi_projection(synthetic_settings, daily, kpi_state)
    result_b = run_kpi_projection(synthetic_settings, daily, kpi_state)

    for key in result_a["projections"]:
        assert result_a["projections"][key].median == result_b["projections"][key].median
