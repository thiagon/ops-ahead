from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse://default:@localhost:9000/default"

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    mlflow_experiment_name: str = "volume-forecast"
    mlflow_registered_model_name: str = "volume-forecast"

    dataset_version: str = "unknown"

    # Temporal split boundaries — see src/split.py.
    train_end: str = "2025-09-30"
    validation_end: str = "2025-10-31"
    holdout_end: str = "2026-01-31"

    auto_promote: bool = True
