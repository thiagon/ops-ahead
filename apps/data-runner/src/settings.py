from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse+http://default:@localhost:8123/default"
    # register_snapshot.py needs clickhouse-driver's native protocol (port 9000);
    # the HTTP URL above (port 8123) doesn't work for it.
    clickhouse_native_url: str = "clickhouse://default:@localhost:9000/default"

    minio_endpoint: str = "http://localhost:9000"
    minio_bucket: str = "ops-ahead-lake"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"

    # Cache-aside snapshot the inference path reads instead of querying
    # ClickHouse directly — see redis_snapshot.py.
    redis_url: str = "redis://localhost:6379/0"

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    # Marts register_snapshot.py counts and fingerprints — see
    # infra/charts/data-runner/values.yaml's run.env.snapshotMarts.
    snapshot_marts: list[str] = []
    source: str = "unknown"

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "trigger.data"
    kafka_topic_status: str = "trigger.status"
    kafka_group_id: str = "data-runner"
    # Bounds how long consume_forever() blocks per poll before checking for
    # SIGTERM — not a hang-prevention timeout anymore, the loop never exits
    # on an empty topic.
    kafka_consumer_timeout_ms: int = 30_000
    metrics_port: int = 8000
