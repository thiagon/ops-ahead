import numpy as np
import pandas as pd
import pytest

from src.features import to_long_format
from src.settings import Settings
from src.train import train_and_log, train_horizon


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
def synthetic_settings(tmp_path) -> Settings:
    return Settings(
        clickhouse_url="clickhouse://default:@localhost:9000/default",
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="volume-forecast-test",
        dataset_version="test-fixture",
        train_end="2025-06-30",
        validation_end="2025-07-31",
        holdout_end="2025-08-31",
        auto_promote=False,
    )


def test_train_horizon_produces_metrics_for_all_priority_groups(synthetic_settings):
    daily = _synthetic_daily()
    long_df = to_long_format(daily)

    result = train_horizon(daily, long_df, synthetic_settings, horizon=1)

    assert set(result["metrics"]["mape_by_priority_ensemble"].keys()) == {"total", "p1", "p2", "p3"}
    assert 0.0 <= result["weight"] <= 1.0
    assert result["metrics"]["mae_ensemble"] >= 0
    assert 0.0 <= result["metrics"]["ci80_coverage"] <= 1.0


def test_train_and_log_completes_and_logs_a_run(synthetic_settings):
    daily = _synthetic_daily()

    run_id = train_and_log(synthetic_settings, daily)

    assert run_id
