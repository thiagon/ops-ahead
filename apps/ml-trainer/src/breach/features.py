from __future__ import annotations

import numpy as np
import pandas as pd


def eligibility_filter(df: pd.DataFrame) -> pd.DataFrame:
    """P1–P3, no parent incident, not "Sem Intervenção" — the KPI-eligible
    population. `first_touch_duration` (the mart `data.fetch_eligible_incidents`
    reads from) already applies `counted_in_kpi = 1`, which encodes exactly
    these three conditions upstream; this function re-checks them explicitly
    rather than trusting that silently, and is what makes the rule itself
    independently testable."""
    mask = (
        df["severity"].isin([1, 2, 3])
        & (df["has_parent_incident"] == 0)
        & (df["status"] != "Sem Intervenção")
    )
    return df.loc[mask].reset_index(drop=True)


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["opened_at"] = pd.to_datetime(df["opened_at"])
    df["opened_hour"] = df["opened_at"].dt.hour
    df["opened_dayofweek"] = df["opened_at"].dt.dayofweek
    return df


def add_manual_open_flag(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["is_manual_open"] = (df["opened_by"] == "Manual").astype(int)
    return df


def add_p4_precursor_features(
    incidents: pd.DataFrame, p4_sequences: pd.DataFrame, window_hours: int
) -> pd.DataFrame:
    """Whether a P4 sequence at the same IC ended in the `window_hours` before
    this incident opened — the precursor pattern confirmed in the EDA
    (docs/insights)."""
    incidents = incidents.copy()
    incidents["opened_at"] = pd.to_datetime(incidents["opened_at"])

    if p4_sequences.empty:
        incidents["p4_precursor_present"] = 0
        incidents["p4_precursor_length"] = 0
        return incidents

    p4_sequences = p4_sequences.copy()
    p4_sequences["sequence_end"] = pd.to_datetime(p4_sequences["sequence_end"])

    merged = incidents[["event_id", "entity_id", "opened_at"]].merge(
        p4_sequences[["entity_id", "sequence_end", "sequence_length"]], on="entity_id", how="left"
    )
    within_window = (merged["sequence_end"] < merged["opened_at"]) & (
        merged["sequence_end"] >= merged["opened_at"] - pd.Timedelta(hours=window_hours)
    )
    matched = merged.loc[within_window]

    precursor_length = matched.groupby("event_id")["sequence_length"].max()
    incidents["p4_precursor_length"] = (
        incidents["event_id"].map(precursor_length).fillna(0).astype(int)
    )
    incidents["p4_precursor_present"] = (incidents["p4_precursor_length"] > 0).astype(int)
    return incidents


def add_ic_window_features(incidents: pd.DataFrame, ic_windows: pd.DataFrame) -> pd.DataFrame:
    """Count of "Sem Intervenção" closures at the same IC in the trailing 1h/6h
    *before* this incident's own bucket — the bucket immediately preceding
    `opened_at`'s own, so the incident itself (and anything after it) can never
    leak into its own feature."""
    incidents = incidents.copy()
    incidents["opened_at"] = pd.to_datetime(incidents["opened_at"])

    for hours in (1, 6):
        column = f"sem_intervencao_count_{hours}h"
        window_df = ic_windows.loc[
            ic_windows["window_hours"] == hours, ["entity_id", "window_start", "sem_intervencao_count"]
        ].copy()
        window_df["window_start"] = pd.to_datetime(window_df["window_start"])

        prior_bucket_start = incidents["opened_at"].dt.floor(f"{hours}h") - pd.Timedelta(hours=hours)
        key = pd.DataFrame({"entity_id": incidents["entity_id"], "window_start": prior_bucket_start})
        merged = key.merge(window_df, on=["entity_id", "window_start"], how="left")
        incidents[column] = pd.to_numeric(merged["sem_intervencao_count"], errors="coerce").fillna(0).astype(int)

    return incidents


def add_group_load_feature(incidents: pd.DataFrame, group_load: pd.DataFrame) -> pd.DataFrame:
    """Incidents opened for the same assignment_group in the hourly bucket
    immediately before this incident's own — "carga do grupo designado".
    Online serving reads the same signal from a Redis snapshot instead of this
    ClickHouse-only join (see infra/charts/ml-model-serving)."""
    incidents = incidents.copy()
    incidents["opened_at"] = pd.to_datetime(incidents["opened_at"])

    group_load = group_load.copy()
    group_load["window_start"] = pd.to_datetime(group_load["window_start"])

    prior_bucket_start = incidents["opened_at"].dt.floor("1h") - pd.Timedelta(hours=1)
    key = pd.DataFrame({"assignment_group": incidents["assignment_group"], "window_start": prior_bucket_start})
    merged = key.merge(
        group_load[["assignment_group", "window_start", "incidents_opened"]],
        on=["assignment_group", "window_start"],
        how="left",
    )
    incidents["group_load_1h"] = pd.to_numeric(merged["incidents_opened"], errors="coerce").fillna(0).astype(int)
    return incidents


def add_recategorization_history_feature(incidents: pd.DataFrame, priority_changes: pd.DataFrame) -> pd.DataFrame:
    """Whether this ticket had a severity transition logged strictly before
    this row's own `received_at` — the "histórico de recategorização"
    cross-model feature (Sprint 2 §3.2), from `priority_changes_log`.

    Filtering to `change_received_at < received_at` is what keeps the
    transition that produced *this* row's own severity from leaking into
    its own feature — a ticket recategorized P3→P2 only counts once this
    row is itself the P2 event or later.
    """
    incidents = incidents.copy()
    incidents["received_at"] = pd.to_datetime(incidents["received_at"])

    if priority_changes.empty:
        incidents["recategorization_count"] = 0
        incidents["was_recategorized"] = 0
        return incidents

    changes = priority_changes.copy()
    changes["received_at"] = pd.to_datetime(changes["received_at"])

    merged = incidents[["event_id", "ticket_number", "received_at"]].merge(
        changes[["ticket_number", "received_at"]].rename(columns={"received_at": "change_received_at"}),
        on="ticket_number",
        how="left",
    )
    prior = merged.loc[merged["change_received_at"] < merged["received_at"]]
    counts = prior.groupby("event_id").size()

    incidents["recategorization_count"] = incidents["event_id"].map(counts).fillna(0).astype(int)
    incidents["was_recategorized"] = (incidents["recategorization_count"] > 0).astype(int)
    return incidents


def add_historical_group_severity_features(df: pd.DataFrame) -> pd.DataFrame:
    """Expanding (leakage-free) history of how far past the 25%-of-OLA mark
    this assignment_group + severity combo has tended to run, using only
    incidents opened *before* the current one.

    This is a proxy for "tempo no primeiro grupo vs. 25% do OLA" — the N1
    escalation rule from docs/insights/03-mentoria-insights.md ("N1 pode
    'cozinhar' o incidente até 25% do OLA antes de escalar"). The dataset has
    no group-handoff timestamps (the mock producer emits one event per
    incident, not a lifecycle stream — see scripts/incident_producer.py), so
    this incident's *own* duration can't be used without leaking the label it
    defines (`kpi_breached` is literally `duration > ola_limit`). Using each
    group+severity's own past behavior instead keeps the signal but drops the
    leakage: only strictly earlier incidents (by `opened_at`) ever contribute
    to a given row's value.
    """
    df = df.sort_values(["assignment_group", "severity", "opened_at"]).reset_index(drop=True).copy()
    df["duration_ratio_of_ola"] = df["duration_seconds"] / df["ola_limit_seconds"]
    df["over_25pct_ola"] = (df["duration_ratio_of_ola"] > 0.25).astype(int)

    key = ["assignment_group", "severity"]
    ratio_by_group = df.groupby(key)["duration_ratio_of_ola"]
    flag_by_group = df.groupby(key)["over_25pct_ola"]

    prior_count = ratio_by_group.cumcount()
    prior_sum_ratio = ratio_by_group.cumsum() - df["duration_ratio_of_ola"]
    prior_sum_flag = flag_by_group.cumsum() - df["over_25pct_ola"]

    df["group_severity_historical_ola_ratio"] = np.where(
        prior_count > 0, prior_sum_ratio / prior_count.replace(0, np.nan), np.nan
    )
    df["group_severity_historical_over_25pct_rate"] = np.where(
        prior_count > 0, prior_sum_flag / prior_count.replace(0, np.nan), np.nan
    )

    # duration_seconds/ola_limit_seconds/over_25pct_ola describe *this*
    # incident's own outcome — they must never reach the model as features,
    # only the expanding-history columns derived from them may.
    return df.drop(columns=["duration_ratio_of_ola", "over_25pct_ola"])


FEATURE_COLUMNS = [
    "severity",
    "assignment_group",
    "opened_hour",
    "opened_dayofweek",
    "is_manual_open",
    "p4_precursor_present",
    "p4_precursor_length",
    "sem_intervencao_count_1h",
    "sem_intervencao_count_6h",
    "group_load_1h",
    "was_recategorized",
    "recategorization_count",
    "group_severity_historical_ola_ratio",
    "group_severity_historical_over_25pct_rate",
]

TARGET_COLUMN = "kpi_breached"


def build_feature_frame(
    incidents: pd.DataFrame,
    p4_sequences: pd.DataFrame,
    ic_windows: pd.DataFrame,
    group_load: pd.DataFrame,
    priority_changes: pd.DataFrame,
    p4_precursor_window_hours: int = 24,
) -> pd.DataFrame:
    """Full pipeline from the raw eligible-incidents population to a
    model-ready frame. Order matters: `add_historical_group_severity_features`
    must run before any row reordering that would break its own sort, and the
    KPI eligibility filter must run first since every join below assumes the
    population is already the KPI-eligible one."""
    frame = eligibility_filter(incidents)
    frame = add_calendar_features(frame)
    frame = add_manual_open_flag(frame)
    frame = add_p4_precursor_features(frame, p4_sequences, p4_precursor_window_hours)
    frame = add_ic_window_features(frame, ic_windows)
    frame = add_group_load_feature(frame, group_load)
    frame = add_recategorization_history_feature(frame, priority_changes)
    frame = add_historical_group_severity_features(frame)

    required = FEATURE_COLUMNS + [TARGET_COLUMN]
    return frame.dropna(subset=[c for c in required if c != "assignment_group"]).reset_index(drop=True)
