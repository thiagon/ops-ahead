from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass

import pandas as pd
from pydantic_settings import BaseSettings, SettingsConfigDict


class BacktestSettings(BaseSettings):
    """Tunable backtest/calibration knobs — env-overridable like every other
    Settings class in this app, instead of module constants a rerun with
    different values would need a code edit for."""

    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    # N1's real escalation window (docs/insights/03-mentoria-insights.md,
    # "Regra de Escalonamento Interno do N1") — the floor a true positive has
    # to clear, or "alert fired before the P1/P2" can't be told apart from
    # "alert fired because of the P1/P2's own burst".
    min_lead_time_seconds: int = 15 * 60
    # Outer bound: how far ahead an alert can still count as predicting a P1/P2.
    lead_time_window_seconds: int = 3600
    # Share of the chronologically-ordered dataset used for calibration —
    # the rest is the evaluation window, never used for tuning.
    calibration_fraction: float = 0.7
    # Z_SCORE_THRESHOLD values the precision x recall curve sweeps.
    curve_thresholds: list[float] = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]


@dataclass(frozen=True)
class Alert:
    entity_id: str
    detected_at: pd.Timestamp
    alert_type: str  # "spike" | "regime_change"
    window_name: str


def chronological_split(
    df: pd.DataFrame, time_column: str, calibration_fraction: float = 0.7
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Splits a time-ordered dataset into a calibration window (used to pick
    an operating point) and an evaluation window (used to check it without
    retuning) — tuning parameters against the same data used to report their
    quality is overfitting to the backtest itself."""
    ordered = df.sort_values(time_column).reset_index(drop=True)
    split_index = int(len(ordered) * calibration_fraction)
    return ordered.iloc[:split_index].reset_index(drop=True), ordered.iloc[split_index:].reset_index(drop=True)


def group_p1_p2_by_entity(
    p1_p2_events: pd.DataFrame, entity_column: str, time_column: str
) -> dict[str, list[pd.Timestamp]]:
    by_entity: dict[str, list[pd.Timestamp]] = defaultdict(list)
    ordered = p1_p2_events[[entity_column, time_column]].sort_values(time_column)
    for entity_id, opened_at in ordered.itertuples(index=False):
        by_entity[entity_id or "unknown"].append(opened_at)
    return by_entity


def _count_covered_p1_p2(
    alerts: list[Alert],
    p1_p2_by_entity: dict[str, list[pd.Timestamp]],
    min_lead_time_seconds: float,
    lead_time_window_seconds: float,
) -> int:
    """Recall's numerator: how many actual P1/P2 incidents had *at least
    one* qualifying alert (lead time within [min_lead_time_seconds,
    lead_time_window_seconds]) before them — the inverse direction of
    precision, which asks how many alerts were followed by a P1/P2."""
    alerts_by_entity: dict[str, list[pd.Timestamp]] = defaultdict(list)
    for alert in alerts:
        alerts_by_entity[alert.entity_id].append(alert.detected_at)

    covered = 0
    for entity_id, incidents in p1_p2_by_entity.items():
        entity_alerts = sorted(alerts_by_entity.get(entity_id, []))
        for incident_at in incidents:
            earliest = incident_at - pd.Timedelta(seconds=lead_time_window_seconds)
            latest = incident_at - pd.Timedelta(seconds=min_lead_time_seconds)
            if any(earliest <= a <= latest for a in entity_alerts):
                covered += 1
    return covered


def evaluate_alerts(
    alerts: list[Alert],
    p1_p2_by_entity: dict[str, list[pd.Timestamp]],
    min_lead_time_seconds: float,
    lead_time_window_seconds: float,
) -> dict:
    """Precision, recall, and lead-time — overall and broken down by
    `alert_type` (z-score "spike" vs CUSUM "regime_change"). A true positive
    requires the nearest P1/P2 at the same entity to land strictly after
    `min_lead_time_seconds` of the alert and within `lead_time_window_seconds`."""
    true_positives = 0
    false_positives_by_ic: dict[str, int] = defaultdict(int)
    lead_times: list[float] = []
    by_type: dict[str, dict] = {}

    for alert in alerts:
        earliest = alert.detected_at + pd.Timedelta(seconds=min_lead_time_seconds)
        latest = alert.detected_at + pd.Timedelta(seconds=lead_time_window_seconds)
        candidates = [t for t in p1_p2_by_entity.get(alert.entity_id, []) if earliest <= t <= latest]

        type_stats = by_type.setdefault(
            alert.alert_type, {"total_alerts": 0, "true_positives": 0, "lead_times": []}
        )
        type_stats["total_alerts"] += 1

        if candidates:
            true_positives += 1
            lead_time = (min(candidates) - alert.detected_at).total_seconds()
            lead_times.append(lead_time)
            type_stats["true_positives"] += 1
            type_stats["lead_times"].append(lead_time)
        else:
            false_positives_by_ic[alert.entity_id] += 1

    total_alerts = len(alerts)
    total_p1_p2 = sum(len(v) for v in p1_p2_by_entity.values())
    covered_p1_p2 = _count_covered_p1_p2(alerts, p1_p2_by_entity, min_lead_time_seconds, lead_time_window_seconds)

    return {
        "total_alerts": total_alerts,
        "true_positives": true_positives,
        "precision": true_positives / total_alerts if total_alerts else float("nan"),
        "total_p1_p2": total_p1_p2,
        "covered_p1_p2": covered_p1_p2,
        "recall": covered_p1_p2 / total_p1_p2 if total_p1_p2 else float("nan"),
        "median_lead_time_seconds": statistics.median(lead_times) if lead_times else float("nan"),
        "false_positives_by_ic": dict(sorted(false_positives_by_ic.items(), key=lambda kv: -kv[1])[:20]),
        "by_alert_type": {
            alert_type: {
                "total_alerts": stats["total_alerts"],
                "true_positives": stats["true_positives"],
                "precision": stats["true_positives"] / stats["total_alerts"] if stats["total_alerts"] else float("nan"),
                "median_lead_time_seconds": statistics.median(stats["lead_times"]) if stats["lead_times"] else float("nan"),
            }
            for alert_type, stats in by_type.items()
        },
    }


def precision_recall_curve(
    thresholds: list[float],
    raise_alerts_for_threshold: Callable[[float], list[Alert]],
    p1_p2_by_entity: dict[str, list[pd.Timestamp]],
    min_lead_time_seconds: float,
    lead_time_window_seconds: float,
) -> list[dict]:
    """Precision × recall as a function of `Z_SCORE_THRESHOLD` — a single
    operating point can't distinguish "fires a lot, hits rarely" from "fires
    rarely, covers what matters"; the curve can."""
    curve = []
    for threshold in thresholds:
        alerts = raise_alerts_for_threshold(threshold)
        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds, lead_time_window_seconds)
        curve.append({"z_score_threshold": threshold, **metrics})
    return curve
