from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    kafka_bootstrap_servers: str = "localhost:9092"
    # Raw, per intake — this consumer is the only reader of either
    # (domain/ubiquitous-language.md#intake).
    kafka_topic_raw_alert: str = "events.raw.alert"
    kafka_topic_raw_monitor: str = "events.raw.monitor"
    # Translated, published for every business consumer downstream.
    kafka_topic_alert: str = "events.alert"
    kafka_topic_monitor: str = "events.monitor"
    kafka_group_id: str = "events-ingest"

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 9000
    clickhouse_database: str = "default"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    minio_endpoint: str = "http://localhost:9000"
    minio_bucket: str = "ops-ahead-lake"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"

    # domain/acl/itsm.md#o-dicionário-de-tradução — outside code, versioned,
    # mounted read-only in the cluster.
    dictionaries_dir: Path = Path(__file__).resolve().parent.parent / "dictionaries"

    batch_max_size: int = 1000
    batch_max_seconds: float = 5.0

    metrics_port: int = 8000
