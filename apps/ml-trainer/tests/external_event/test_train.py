import numpy as np
import pandas as pd
import pytest

from external_event.train import train_and_log
from settings import Settings


def _synthetic_daily(days: int = 60) -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=days, freq="D")
    rng = np.random.default_rng(3)
    rows = []
    for i, date in enumerate(dates):
        total = 20 + rng.integers(-3, 4)
        total = total if i != days - 1 else 400  # spike on the last day
        rows.append(
            {
                "date": date,
                "source": "itsm",
                "total_signals": total,
                "firing_count": int(total * 0.6),
                "cleared_count": int(total * 0.4),
                "p1_share": 0.1,
                "critical_share": 0.3,
                "unique_entities": 5,
            }
        )
    return pd.DataFrame(rows)


@pytest.fixture
def synthetic_settings(tmp_path) -> Settings:
    return Settings(
        clickhouse_url="clickhouse://default:@localhost:9000/default",
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="external-event-detection-test",
        mlflow_registered_model_name="external-event-detection-test",
        dataset_version="test-fixture",
        auto_promote=False,
    )


def test_train_and_log_completes_and_logs_a_run(synthetic_settings):
    daily = _synthetic_daily()

    run_id = train_and_log(synthetic_settings, daily)

    assert run_id
