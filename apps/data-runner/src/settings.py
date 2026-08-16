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

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    # Marts register_snapshot.py counts and fingerprints — see
    # infra/charts/data-runner/values.yaml's run.env.snapshotMarts.
    snapshot_marts: list[str] = []
    source: str = "unknown"

    kafka_bootstrap_servers: str = "localhost:9092"
    kafka_topic: str = "trigger.data"
    kafka_topic_status: str = "trigger.status"
    kafka_group_id: str = "data-runner"
    # Bounds consume_one() so a Job doesn't hang if KEDA fires on a topic
    # that's already empty by the time it polls.
    kafka_consumer_timeout_ms: int = 30_000
