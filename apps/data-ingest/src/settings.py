from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "incidents.received"
    kafka_group_id: str = "incidents-ingest"

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 9000
    clickhouse_database: str = "default"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    minio_endpoint: str = "http://localhost:9000"
    minio_bucket: str = "ops-ahead-lake"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"

    batch_max_size: int = 1000
    batch_max_seconds: float = 5.0

    metrics_port: int = 8000
