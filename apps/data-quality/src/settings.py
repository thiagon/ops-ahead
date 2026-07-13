from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    clickhouse_database: str = "default"
    clickhouse_user: str = "default"
    clickhouse_password: str = ""

    minio_endpoint: str = "http://localhost:9000"
    minio_bucket: str = "ops-ahead-lake"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
