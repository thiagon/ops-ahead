from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse://default:@localhost:9000/default"

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    # Falls back to trigger.py's EXPERIMENT_NAMES when unset; a caller can
    # still override either via env.
    mlflow_experiment_name: str | None = None
    mlflow_registered_model_name: str | None = None

    dataset_version: str = "unknown"

    # No default: a fixed one would silently reintroduce the dataset-specific
    # coupling that trigger.ml events replace (docs/insights/temporal-split-data-dependency.md).
    # src/main.py enforces all three are present before training.
    train_end: str | None = None
    validation_end: str | None = None
    holdout_end: str | None = None

    # breach-risk only. Same threshold apps/data-deadline-tracker uses to flag
    # abandonment — measured once in docs/insights/fluxo-do-incidente.md, both
    # places need the same number (see spec.md, "Treino revisto").
    breach_abandoned_ratio: float = 10.0
    optuna_trials: int = 50

    # external-event (Isolation Forest) only. Expected share of days flagged
    # anomalous — not tuned against a labeled set (none exists), a starting
    # point consistent with the mentoria's account of external events being
    # rare (docs/insights/03-mentoria-insights.md).
    external_event_contamination: float = 0.05

    # kpi_projection only (Monte Carlo).
    kpi_projection_n_simulations: int = 2000
    kpi_projection_seed: int = 42
    kpi_projection_holdout_days: int = 14
    # PPR targets are Locaweb business input, never derivable from the
    # dataset — left unset until an operator supplies them. P(fechar mês)
    # comes back as None for a dimension whose target is unset.
    kpi_target_volume_p2: int | None = None
    kpi_target_volume_p3: int | None = None
    kpi_target_breaches_p2: int | None = None
    kpi_target_breaches_p3: int | None = None

    auto_promote: bool = True

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "trigger.ml"
    kafka_topic_status: str = "trigger.status"
    kafka_group_id: str = "ml-trainer"
    # Bounds how long consume_forever() blocks per poll before checking for
    # SIGTERM — not a hang-prevention timeout anymore, the loop never exits
    # on an empty topic.
    kafka_consumer_timeout_ms: int = 30_000
    metrics_port: int = 8000
