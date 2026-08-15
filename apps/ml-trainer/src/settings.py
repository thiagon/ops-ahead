from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse://default:@localhost:9000/default"

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    # Resolved per domain (see src/main.py's EXPERIMENT_NAMES) when left unset —
    # "volume-forecast"/"breach-risk" respectively — so a caller can still
    # override either via env.
    mlflow_experiment_name: str | None = None
    mlflow_registered_model_name: str | None = None

    dataset_version: str = "unknown"

    # Temporal split boundaries — see src/split.py. No default: every run now
    # comes from a trigger-service payload (see
    # docs/insights/temporal-split-data-dependency.md); a fixed default here
    # would silently reintroduce the dataset-specific coupling that payload
    # replaces. src/main.py enforces all three are present before training.
    train_end: str | None = None
    validation_end: str | None = None
    holdout_end: str | None = None

    # breach-risk only.
    p4_precursor_window_hours: int = 24
    optuna_trials: int = 50

    auto_promote: bool = True
