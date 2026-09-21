import numpy as np
import pandas as pd
import pytest

from external_event.train import train_and_log
from settings import Settings


def _synthetic_alert(days: int = 60) -> pd.DataFrame:
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
                "total_incidents": total,
                "unique_entities": 5,
                "incidents_per_entity": total / 5,
                "critical_share": 0.3,
                "manual_open_share": 0.2,
            }
        )
    return pd.DataFrame(rows)


def _synthetic_monitor(days: int = 60) -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=days, freq="D")
    rows = []
    for date in dates:
        rows.append(
            {
                "date": date,
                "source": "zabbix",
                "total_signals": 30,
                "unique_entities": 6,
                "firing_count": 18,
                "cleared_count": 12,
                "p1_share": 0.1,
                "critical_share": 0.3,
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


def test_train_and_log_completes_without_any_monitor_origin(synthetic_settings):
    """The shape most tenants have: incidents only, no origin observing
    conditions. The detector has to train on that alone."""
    run_id = train_and_log(synthetic_settings, _synthetic_alert())

    assert run_id


def test_train_and_log_completes_with_both_intakes(synthetic_settings):
    run_id = train_and_log(synthetic_settings, _synthetic_alert(), _synthetic_monitor())

    assert run_id
