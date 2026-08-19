import mlflow
import numpy as np
import pandas as pd
import pytest

from drift.monitor import PSI_SIGNIFICANT_THRESHOLD
from drift.run import run_drift_monitoring
from settings import Settings
from trigger import EXPERIMENT_NAMES


def _promote_fake_production(tracking_uri: str, registered_model_name: str, train_end: str) -> None:
    """Registers a Production model version carrying only the `train_end`
    param drift needs — no real artifact, matching how `_production_train_end`
    only ever reads `run.data.params`, never loads the model itself."""
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(f"{registered_model_name}-fixture")
    client = mlflow.MlflowClient(tracking_uri=tracking_uri)

    with mlflow.start_run() as run:
        mlflow.log_param("train_end", train_end)
        run_id = run.info.run_id

    client.create_registered_model(registered_model_name)
    version = client.create_model_version(name=registered_model_name, source=f"runs:/{run_id}/model", run_id=run_id)
    client.transition_model_version_stage(name=registered_model_name, version=version.version, stage="Production")


@pytest.fixture
def synthetic_settings(tmp_path) -> Settings:
    return Settings(
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="drift-monitoring-test",
    )


def _feature_frame(dates: pd.DatetimeIndex, stable: np.ndarray, shifted: np.ndarray) -> pd.DataFrame:
    return pd.DataFrame({"date": dates, "stable": stable, "shifted": shifted})


def test_run_drift_monitoring_reports_shift_after_train_end(synthetic_settings):
    train_end = "2026-01-31"
    _promote_fake_production(synthetic_settings.mlflow_tracking_uri, EXPERIMENT_NAMES["volume"], train_end)

    rng = np.random.default_rng(7)
    reference_dates = pd.date_range("2025-02-01", periods=365, freq="D")
    current_dates = pd.date_range("2026-02-01", periods=90, freq="D")
    frame = pd.concat(
        [
            _feature_frame(reference_dates, rng.normal(0, 1, len(reference_dates)), rng.normal(0, 1, len(reference_dates))),
            _feature_frame(current_dates, rng.normal(0, 1, len(current_dates)), rng.normal(6, 1, len(current_dates))),
        ],
        ignore_index=True,
    )

    outcome = run_drift_monitoring(synthetic_settings, {"volume": (frame, "date", ["stable", "shifted"])})

    assert outcome["run_id"]
    results = outcome["results"]["volume"]
    assert results["stable"].psi < PSI_SIGNIFICANT_THRESHOLD
    assert results["shifted"].psi > PSI_SIGNIFICANT_THRESHOLD


def test_run_drift_monitoring_raises_when_no_data_accrued_since_promotion(synthetic_settings):
    train_end = "2026-06-30"  # after every row in the frame below
    _promote_fake_production(synthetic_settings.mlflow_tracking_uri, EXPERIMENT_NAMES["breach"], train_end)

    dates = pd.date_range("2026-01-01", "2026-01-10", freq="D")
    frame = pd.DataFrame({"opened_at": dates, "severity": range(len(dates))})

    with pytest.raises(ValueError, match="no production data has accrued"):
        run_drift_monitoring(synthetic_settings, {"breach": (frame, "opened_at", ["severity"])})


def test_run_drift_monitoring_raises_when_no_production_version_exists(synthetic_settings):
    mlflow.set_tracking_uri(synthetic_settings.mlflow_tracking_uri)
    dates = pd.date_range("2026-01-01", "2026-01-10", freq="D")
    frame = pd.DataFrame({"date": dates, "avg_opened_hour": range(len(dates))})

    with pytest.raises(ValueError, match="no Production version"):
        run_drift_monitoring(synthetic_settings, {"volume": (frame, "date", ["avg_opened_hour"])})
