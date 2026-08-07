from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse://default:@localhost:9000/default"

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    mlflow_experiment_name: str = "breach-risk"
    mlflow_registered_model_name: str = "breach-risk"

    dataset_version: str = "unknown"

    # Temporal split boundaries — identical function and identical boundaries
    # to ml-volume-model (see src/split.py); duplicated here on purpose since
    # each training job ships as its own container image.
    train_end: str = "2025-09-30"
    validation_end: str = "2025-10-31"
    holdout_end: str = "2026-01-31"

    # Trailing window (hours) a P4 sequence at the same IC still counts as a
    # precursor for an incident opened after it.
    p4_precursor_window_hours: int = 24

    optuna_trials: int = 50

    auto_promote: bool = True
