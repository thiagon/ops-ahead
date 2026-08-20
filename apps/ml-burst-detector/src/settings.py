from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "events.monitor"
    kafka_group_id: str = "burst-detector"
    alert_topic: str = "alerts.burst"

    redis_url: str = "redis://localhost:6379/0"

    metrics_port: int = 8000
