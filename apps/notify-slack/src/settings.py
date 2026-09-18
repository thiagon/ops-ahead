from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "events.alert"
    kafka_group_id: str = "notify-slack"

    slack_bot_token: str
    slack_channel_id: str

    metrics_port: int = 8000
