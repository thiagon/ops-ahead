from __future__ import annotations

import logging
from pathlib import Path

import mlflow
import pandas as pd
from sklearn.ensemble import IsolationForest

from external_event.features import FEATURE_COLUMNS, to_daily_frame
from external_event.model import ExternalEventModel
from settings import Settings

LOGGER = logging.getLogger(__name__)


def fit_isolation_forest(frame: pd.DataFrame, contamination: float, random_state: int = 42) -> IsolationForest:
    model = IsolationForest(contamination=contamination, random_state=random_state, n_estimators=200)
    model.fit(frame[FEATURE_COLUMNS])
    return model


def train_and_log(settings: Settings, daily: pd.DataFrame, dataset_version: str | None = None) -> str:
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    frame = to_daily_frame(daily)
    model = fit_isolation_forest(frame, settings.external_event_contamination)

    bundled_model = ExternalEventModel(model)
    flagged = bundled_model.predict(None, frame)

    with mlflow.start_run() as run:
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("contamination", settings.external_event_contamination)
        mlflow.log_param("n_days", len(frame))
        mlflow.log_metric("flagged_share", float(flagged["is_external_event"].mean()))

        mlflow.pyfunc.log_model(
            name="model",
            python_model=bundled_model,
            # ExternalEventModel.predict() calls back into external_event.features
            # — both need to travel with the artifact, same reason breach/volume's
            # train.py bundles code_paths this way (see the comment there).
            code_paths=[str(Path(__file__).resolve().parent)],
            registered_model_name=settings.mlflow_registered_model_name if settings.auto_promote else None,
        )
        run_id = run.info.run_id

    if settings.auto_promote:
        promote_latest(settings, run_id)

    return run_id


def promote_latest(settings: Settings, run_id: str) -> None:
    client = mlflow.MlflowClient(tracking_uri=settings.mlflow_tracking_uri)
    versions = client.search_model_versions(f"name='{settings.mlflow_registered_model_name}'")
    matching = [v for v in versions if v.run_id == run_id]
    if not matching:
        LOGGER.warning("No registered model version found for run %s — skipping promotion.", run_id)
        return
    version = matching[0].version
    client.transition_model_version_stage(
        name=settings.mlflow_registered_model_name,
        version=version,
        stage="Production",
        archive_existing_versions=True,
    )
    LOGGER.info("Promoted %s v%s (run %s) to Production.", settings.mlflow_registered_model_name, version, run_id)
