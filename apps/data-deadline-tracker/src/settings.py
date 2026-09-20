from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    kafka_bootstrap_servers: str = "localhost:9092"
    # Translated alert events — this is what the open-occurrence set is
    # built and kept current from (domain/ubiquitous-language.md#marco).
    kafka_topic_alert: str = "events.alert"
    kafka_topic_milestones: str = "deadlines.milestone"
    # Compacted — the OLA deadlines, rehydrated at boot. Each replica reads the
    # whole log, so the group id is unique per boot.
    kafka_topic_rules_deadline: str = "rules.deadline"
    # Unique per boot, not fixed: on restart the open-occurrence set is
    # reconstructed from ClickHouse (see tracker.py), so this only needs to
    # pick up events from here forward — replaying a stale committed offset
    # would double-process what reconstruction already accounts for.
    kafka_group_id_prefix: str = "deadline-tracker"

    clickhouse_url: str = "clickhouse://default:@localhost:9000/default"

    # How often the open-occurrence set is swept for newly-crossed
    # milestones — independent of Kafka traffic, since a milestone can fire
    # purely from time passing with no new event.
    tick_seconds: float = 30.0

    # Consumed-ratio multiple past which an open, eligible incident counts
    # as abandoned — a separate axis from the 25/50/75/100% milestones, not
    # a per-tenant contract like the deadline itself (see
    # seeds/tenant_deadlines.csv in data-runner). Same threshold the training
    # set (ml-trainer) uses to exclude abandoned incidents — measured once in
    # docs/insights/fluxo-do-incidente.md.
    abandoned_ratio: float = 10.0

    metrics_port: int = 8000
