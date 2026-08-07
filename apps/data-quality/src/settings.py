from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse+http://default:@localhost:8123/default"

    minio_endpoint: str = "http://localhost:9000"
    minio_bucket: str = "ops-ahead-lake"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
