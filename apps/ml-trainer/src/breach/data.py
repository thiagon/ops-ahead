from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

# One row per (incidente × marco) — reconstructed point-in-time by the mart
# itself (apps/data-runner/models/marts/breach_training_examples.sql).
# has_breached/final_consumed_ratio/final_duration_seconds are the eventual
# outcome (the label and the exclusion criteria), everything else is only
# what was known at occurred_at.
BREACH_TRAINING_EXAMPLES_COLUMNS = [
    "milestone_id",
    "tenant_id",
    "source",
    "external_id",
    "entity_id",
    "kind",
    "severity_at_milestone",
    "opened_at",
    "acknowledged_at_at_milestone",
    "due_at",
    "deadline_seconds",
    "consumed_ratio_at_milestone",
    "occurred_at",
    "owner",
    "reported_by",
    "parent_id",
    "resolution_code",
    "status",
    "severity_changes",
    "is_eligible",
    "group_load",
    "no_intervention_count_1h",
    "no_intervention_count_6h",
    "no_intervention_precursor_length",
    "has_breached",
    "final_consumed_ratio",
    "final_duration_seconds",
]

SIGNAL_COUNTS_COLUMNS = ["entity_id", "window_minutes", "window_start", "signal_count"]

AUTO_RESOLUTION_RATE_COLUMNS = ["entity_id", "auto_resolution_rate"]

SEVERITY_ESCALATIONS_COLUMNS = ["entity_id", "date", "escalation_count"]


def fetch_breach_training_examples(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(BREACH_TRAINING_EXAMPLES_COLUMNS)
    rows = client.execute(f"select {columns} from breach_training_examples order by occurred_at")
    return pd.DataFrame(rows, columns=BREACH_TRAINING_EXAMPLES_COLUMNS)


def fetch_signal_counts(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(SIGNAL_COUNTS_COLUMNS)
    rows = client.execute(
        f"select {columns} from gold_monitor_signal_counts where window_minutes in (15, 60) "
        "order by entity_id, window_minutes, window_start"
    )
    return pd.DataFrame(rows, columns=SIGNAL_COUNTS_COLUMNS)


def fetch_auto_resolution_rate(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(AUTO_RESOLUTION_RATE_COLUMNS)
    rows = client.execute(f"select {columns} from gold_monitor_auto_resolution_rate order by entity_id")
    return pd.DataFrame(rows, columns=AUTO_RESOLUTION_RATE_COLUMNS)


def fetch_severity_escalations(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(SEVERITY_ESCALATIONS_COLUMNS)
    rows = client.execute(f"select {columns} from gold_monitor_severity_escalations order by entity_id, date")
    return pd.DataFrame(rows, columns=SEVERITY_ESCALATIONS_COLUMNS)


def dataset_version(*frames: pd.DataFrame) -> str:
    """Deterministic fingerprint of the exact rows a run trained on — logged as
    an MLflow param so a run can be traced back to what the marts looked like
    at train time, without depending on an operator-supplied version string."""
    hasher = hashlib.sha256()
    for frame in frames:
        hasher.update(pd.util.hash_pandas_object(frame, index=False).values.tobytes())
    return hasher.hexdigest()[:16]
