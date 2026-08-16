from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    clickhouse_url: str = "clickhouse+http://default:@localhost:8123/default"
    # register_snapshot.py needs clickhouse-driver's native protocol client
    # (port 9000), not the HTTP one above (port 8123) — a second URL, not a
    # split of the first, since they're different ports/protocols to the same
    # ClickHouse. Composed by the chart via $(VAR), same as clickhouse_url.
    clickhouse_native_url: str = "clickhouse://default:@localhost:9000/default"

    minio_endpoint: str = "http://localhost:9000"
    minio_bucket: str = "ops-ahead-lake"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"

    mlflow_tracking_uri: str = "http://mlflow-tracking.ml.svc.cluster.local:5000"
    # Marts register_snapshot.py counts and fingerprints — see
    # pipelines/data-itsm-daily/values.yaml's snapshot.marts (same list,
    # ported from the old WorkflowTemplate's inline script).
    snapshot_marts: list[str] = []
    # Tag on the MLflow run — which pipeline config produced this snapshot.
    source: str = "unknown"

    kafka_bootstrap_servers: str = "localhost:9092"
    # data-runner only ever consumes one topic — no _data suffix needed here,
    # unlike ui-orchestrator's KAFKA_TOPIC_ML/KAFKA_TOPIC_DATA which route
    # between two.
    kafka_topic: str = "trigger.data"
    kafka_topic_status: str = "trigger.status"
    kafka_group_id: str = "data-runner"
    # consume_one() must not block a Job forever if the topic is (rarely)
    # empty when KEDA fires it — see conductor/tracks/exec-trigger_20260807/spec.md.
    kafka_consumer_timeout_ms: int = 30_000
