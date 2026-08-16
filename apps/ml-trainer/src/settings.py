from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse://default:@localhost:9000/default"

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    # Falls back to src/main.py's EXPERIMENT_NAMES ("volume-forecast"/
    # "breach-risk") when unset; a caller can still override either via env.
    mlflow_experiment_name: str | None = None
    mlflow_registered_model_name: str | None = None

    dataset_version: str = "unknown"

    # No default: a fixed one would silently reintroduce the dataset-specific
    # coupling that trigger.ml events replace (docs/insights/temporal-split-data-dependency.md).
    # src/main.py enforces all three are present before training.
    train_end: str | None = None
    validation_end: str | None = None
    holdout_end: str | None = None

    # breach-risk only.
    p4_precursor_window_hours: int = 24
    optuna_trials: int = 50

    auto_promote: bool = True

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "trigger.ml"
    kafka_topic_status: str = "trigger.status"
    kafka_group_id: str = "ml-trainer"
    # Bounds consume_one() so a Job doesn't hang if KEDA fires on a topic
    # that's already empty by the time it polls.
    kafka_consumer_timeout_ms: int = 30_000
