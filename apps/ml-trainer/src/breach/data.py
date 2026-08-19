from __future__ import annotations

import hashlib

import pandas as pd
from clickhouse_driver import Client

from settings import Settings

ELIGIBLE_INCIDENTS_COLUMNS = [
    "event_id",
    "entity_id",
    "ticket_number",
    "received_at",
    "opened_at",
    "assignment_group",
    "opened_by",
    "has_parent_incident",
    "status",
    "severity",
    "duration_seconds",
    "ola_limit_seconds",
    "kpi_breached",
]

P4_SEQUENCES_COLUMNS = ["entity_id", "sequence_start", "sequence_end", "sequence_length"]

IC_WINDOWS_COLUMNS = ["entity_id", "window_hours", "window_start", "no_intervention_count"]

GROUP_LOAD_COLUMNS = ["assignment_group", "window_start", "incidents_opened"]

PRIORITY_CHANGES_COLUMNS = ["ticket_number", "received_at", "severity_from", "severity_to"]


def fetch_eligible_incidents(settings: Settings) -> pd.DataFrame:
    """`first_touch_duration` is already filtered to `counted_in_kpi = 1`, which
    is exactly the P1–P3 / no-parent / not-"no_intervention" population the
    breach model trains on."""
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(ELIGIBLE_INCIDENTS_COLUMNS)
    rows = client.execute(f"select {columns} from first_touch_duration order by opened_at")
    return pd.DataFrame(rows, columns=ELIGIBLE_INCIDENTS_COLUMNS)


def fetch_p4_sequences(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(P4_SEQUENCES_COLUMNS)
    rows = client.execute(f"select {columns} from p4_sequences_by_ci order by entity_id, sequence_start")
    return pd.DataFrame(rows, columns=P4_SEQUENCES_COLUMNS)


def fetch_ic_windows(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(IC_WINDOWS_COLUMNS)
    rows = client.execute(
        f"select {columns} from incidents_by_ic where window_hours in (1, 6) order by entity_id, window_start"
    )
    return pd.DataFrame(rows, columns=IC_WINDOWS_COLUMNS)


def fetch_group_load(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(GROUP_LOAD_COLUMNS)
    rows = client.execute(f"select {columns} from group_load_by_window order by assignment_group, window_start")
    return pd.DataFrame(rows, columns=GROUP_LOAD_COLUMNS)


def fetch_priority_changes(settings: Settings) -> pd.DataFrame:
    client = Client.from_url(settings.clickhouse_url)
    columns = ", ".join(PRIORITY_CHANGES_COLUMNS)
    rows = client.execute(f"select {columns} from priority_changes_log order by ticket_number, received_at")
    return pd.DataFrame(rows, columns=PRIORITY_CHANGES_COLUMNS)


def dataset_version(*frames: pd.DataFrame) -> str:
    """Deterministic fingerprint of the exact rows a run trained on — logged as
    an MLflow param so a run can be traced back to what the marts looked like
    at train time, without depending on an operator-supplied version string."""
    hasher = hashlib.sha256()
    for frame in frames:
        hasher.update(pd.util.hash_pandas_object(frame, index=False).values.tobytes())
    return hasher.hexdigest()[:16]
