from __future__ import annotations

import numpy as np
import pandas as pd


def eligibility_filter(df: pd.DataFrame) -> pd.DataFrame:
    """`breach_training_examples.is_eligible` is already reconstructed
    point-in-time by the mart (severity 1-3, no parent, not
    "no_intervention", as known at the marco) — trusted as-is, not
    recalculated here (spec.md, "Treino revisto")."""
    return df.loc[df["is_eligible"]].reset_index(drop=True)


def closed_filter(df: pd.DataFrame) -> pd.DataFrame:
    """An open incident's `has_breached=False` is provisional — it can still
    flip to True before it closes, so it is not yet a stable label. Only
    incidents with a known final duration (closed) are kept, same population
    `first_touch_duration` fed the old pipeline."""
    return df.loc[df["final_duration_seconds"].notna()].reset_index(drop=True)


def abandonment_filter(df: pd.DataFrame, abandoned_ratio: float) -> pd.DataFrame:
    """Incidents that ran past `abandoned_ratio` times their deadline are not
    cases the operation could have saved (docs/insights/fluxo-do-incidente.md)
    — excluded on the incident's own eventual `final_consumed_ratio`, the
    same threshold apps/data-deadline-tracker uses to flag abandonment."""
    return df.loc[df["final_consumed_ratio"] < abandoned_ratio].reset_index(drop=True)


def noise_threshold(df: pd.DataFrame) -> float:
    """`greatest(60, percentile(0.01)(duration_seconds))` over the eligible,
    closed population — kickoff §5 ("incidentes de duração ínfima ... são
    ruído de rede"). Computed on `final_duration_seconds` since that is the
    incident's real, completed duration."""
    return float(max(60.0, df["final_duration_seconds"].quantile(0.01)))


def noise_filter(df: pd.DataFrame, threshold: float) -> pd.DataFrame:
    return df.loc[df["final_duration_seconds"] >= threshold].reset_index(drop=True)


def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["severity"] = df["severity_at_milestone"]
    df["opened_at"] = pd.to_datetime(df["opened_at"])
    df["opened_hour"] = df["opened_at"].dt.hour
    df["opened_dayofweek"] = df["opened_at"].dt.dayofweek
    return df


def add_manual_open_flag(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["is_manual_open"] = (df["reported_by"] == "manual").astype(int)
    return df


def add_precursor_features(df: pd.DataFrame) -> pd.DataFrame:
    """`no_intervention_precursor_length` is already reconstructed
    point-in-time by the mart (resolution known before the marco, same
    entity) — the kickoff's actual predictive signal (§4, "Gatilhamento
    Preditivo"), not the old `severity = 4` passthrough this feature was
    confused with in the Fase 5 marts (see plan.md)."""
    df = df.copy()
    df["p4_precursor_length"] = df["no_intervention_precursor_length"].fillna(0).astype(int)
    df["p4_precursor_present"] = (df["p4_precursor_length"] > 0).astype(int)
    return df


def add_recategorization_history_feature(df: pd.DataFrame) -> pd.DataFrame:
    """`severity_changes` is already reconstructed point-in-time by the mart
    (count of severity transitions strictly before the marco) — no need to
    recount `priority_changes_log` by hand."""
    df = df.copy()
    df["recategorization_count"] = df["severity_changes"].fillna(0).astype(int)
    df["was_recategorized"] = (df["recategorization_count"] > 0).astype(int)
    return df


def add_deadline_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["consumed_ratio"] = df["consumed_ratio_at_milestone"]
    df["due_at"] = pd.to_datetime(df["due_at"])
    df["occurred_at"] = pd.to_datetime(df["occurred_at"])
    df["time_remaining_seconds"] = (df["due_at"] - df["occurred_at"]).dt.total_seconds()
    df["was_acknowledged"] = df["acknowledged_at_at_milestone"].notna().astype(int)
    return df


def _asof_join(
    df: pd.DataFrame,
    other: pd.DataFrame,
    left_on: str,
    right_on: str,
    value_col: str,
    by: str = "entity_id",
    allow_exact_matches: bool = True,
) -> pd.Series:
    """Nearest-prior-value join keyed by `by`, matching `other`'s last row
    with `right_on <= df[left_on]` — the point-in-time lookup every monitor
    context feature below needs (never a window/day that starts after the
    marco)."""
    left = df[[by, left_on]].reset_index().rename(columns={"index": "_row"}).sort_values(left_on)
    right = other[[by, right_on, value_col]].sort_values(right_on)
    merged = pd.merge_asof(
        left,
        right,
        left_on=left_on,
        right_on=right_on,
        by=by,
        direction="backward",
        allow_exact_matches=allow_exact_matches,
    )
    return merged.set_index("_row")[value_col].reindex(df.index)


def add_monitor_context_features(
    df: pd.DataFrame,
    signal_counts: pd.DataFrame,
    auto_resolution_rate: pd.DataFrame,
    severity_escalations: pd.DataFrame,
) -> pd.DataFrame:
    """Context from the `monitor` chain's own gold, by `entity_id` (Fase 4) —
    what was happening on the same infrastructure element around the marco,
    not the alert chain's own history."""
    df = df.copy()
    df["occurred_at"] = pd.to_datetime(df["occurred_at"])

    for minutes, column in ((15, "entity_signal_count_15m"), (60, "entity_signal_count_1h")):
        window_df = signal_counts.loc[signal_counts["window_minutes"] == minutes].copy()
        window_df["window_start"] = pd.to_datetime(window_df["window_start"])
        window_df["signal_count"] = pd.to_numeric(window_df["signal_count"], errors="coerce")
        joined = _asof_join(df, window_df, left_on="occurred_at", right_on="window_start", value_col="signal_count")
        df[column] = pd.to_numeric(joined, errors="coerce").fillna(0)

    rate = auto_resolution_rate.set_index("entity_id")["auto_resolution_rate"]
    df["entity_auto_resolution_rate"] = df["entity_id"].map(rate)

    escalations = severity_escalations.copy()
    escalations["date"] = pd.to_datetime(escalations["date"])
    escalations["escalation_count"] = pd.to_numeric(escalations["escalation_count"], errors="coerce").fillna(0)
    escalations = escalations.sort_values(["entity_id", "date"])
    escalations["cumulative_escalations"] = escalations.groupby("entity_id")["escalation_count"].cumsum()
    df["occurred_date"] = df["occurred_at"].dt.floor("D")
    # allow_exact_matches=False — a day's escalation count is a completed
    # daily aggregate; the marco's own day is still in progress, so its
    # bucket cannot contribute yet.
    joined_escalations = _asof_join(
        df,
        escalations,
        left_on="occurred_date",
        right_on="date",
        value_col="cumulative_escalations",
        allow_exact_matches=False,
    )
    df["entity_severity_escalations"] = pd.to_numeric(joined_escalations, errors="coerce").fillna(0)
    return df.drop(columns=["occurred_date"])


def add_historical_group_severity_features(df: pd.DataFrame) -> pd.DataFrame:
    """Expanding (leakage-free) history of how far past the deadline this
    owner + severity combo has tended to run, using only OTHER incidents
    that opened strictly before this one — same technique as before
    (Fase 5), just computed once per incident (deduped to its first marco,
    the historical population does not change across that incident's own
    marcos) and broadcast to every marco row of that incident.
    """
    df = df.copy()
    identity = ["tenant_id", "source", "external_id"]

    per_incident = (
        df.sort_values("opened_at")
        .drop_duplicates(subset=identity, keep="first")[
            [*identity, "owner", "severity", "opened_at", "final_duration_seconds", "deadline_seconds"]
        ]
        .copy()
    )
    per_incident["duration_ratio_of_deadline"] = (
        per_incident["final_duration_seconds"] / per_incident["deadline_seconds"]
    )
    per_incident["over_25pct_deadline"] = (per_incident["duration_ratio_of_deadline"] > 0.25).astype(int)
    per_incident = per_incident.sort_values(["owner", "severity", "opened_at"]).reset_index(drop=True)

    key = ["owner", "severity"]
    ratio_by_group = per_incident.groupby(key)["duration_ratio_of_deadline"]
    flag_by_group = per_incident.groupby(key)["over_25pct_deadline"]

    prior_count = ratio_by_group.cumcount()
    prior_sum_ratio = ratio_by_group.cumsum() - per_incident["duration_ratio_of_deadline"]
    prior_sum_flag = flag_by_group.cumsum() - per_incident["over_25pct_deadline"]

    per_incident["group_severity_historical_ola_ratio"] = np.where(
        prior_count > 0, prior_sum_ratio / prior_count.replace(0, np.nan), np.nan
    )
    per_incident["group_severity_historical_over_25pct_rate"] = np.where(
        prior_count > 0, prior_sum_flag / prior_count.replace(0, np.nan), np.nan
    )

    lookup = per_incident.set_index(identity)[
        ["group_severity_historical_ola_ratio", "group_severity_historical_over_25pct_rate"]
    ]
    return df.join(lookup, on=identity)


FEATURE_COLUMNS = [
    "severity",
    "owner",
    "opened_hour",
    "opened_dayofweek",
    "is_manual_open",
    "p4_precursor_present",
    "p4_precursor_length",
    "no_intervention_count_1h",
    "no_intervention_count_6h",
    "group_load",
    "was_recategorized",
    "recategorization_count",
    "group_severity_historical_ola_ratio",
    "group_severity_historical_over_25pct_rate",
    "consumed_ratio",
    "time_remaining_seconds",
    "was_acknowledged",
    "entity_signal_count_15m",
    "entity_signal_count_1h",
    "entity_auto_resolution_rate",
    "entity_severity_escalations",
]

TARGET_COLUMN = "has_breached"


def build_feature_frame(
    examples: pd.DataFrame,
    signal_counts: pd.DataFrame,
    auto_resolution_rate: pd.DataFrame,
    severity_escalations: pd.DataFrame,
    abandoned_ratio: float = 10.0,
) -> pd.DataFrame:
    """Full pipeline from `breach_training_examples` (one row per marco) to a
    model-ready frame. Order matters: eligibility/closed/abandonment/noise
    filters must run before `add_historical_group_severity_features`, which
    expects the population it computes history over to already be the final
    training population, and calendar/deadline/precursor features must run
    before the historical-ratio step since it reads `severity`/`owner`.
    """
    frame = eligibility_filter(examples)
    frame = closed_filter(frame)
    frame = abandonment_filter(frame, abandoned_ratio)
    frame = noise_filter(frame, noise_threshold(frame))

    frame = add_calendar_features(frame)
    frame = add_manual_open_flag(frame)
    frame = add_precursor_features(frame)
    frame = add_recategorization_history_feature(frame)
    frame = add_deadline_features(frame)
    frame = add_monitor_context_features(frame, signal_counts, auto_resolution_rate, severity_escalations)
    frame = add_historical_group_severity_features(frame)

    required = FEATURE_COLUMNS + [TARGET_COLUMN]
    return frame.dropna(subset=[c for c in required if c != "owner"]).reset_index(drop=True)
