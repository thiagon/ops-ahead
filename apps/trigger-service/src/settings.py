from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    http_port: int = 8080

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "trigger.requests"
    kafka_group_id: str = "trigger-service"

    # GET /runs/{run_id} looks for the Workflow in each of these namespaces,
    # in order, until one 200s — see src/k8s.py.
    run_namespaces: list[str] = ["ml", "data"]
