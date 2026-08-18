"""Backtest the burst detector against the real historical dataset.

Usage: uv run --package ops-ahead-ml-burst-detector python scripts/backtest.py

Replays assets/incidents.csv (real ITSM history, chronological) through the
exact same detection algorithm the live consumer uses (src/detector.py), with
an in-memory state stand-in for Redis, and measures — separately for a
calibration window and an evaluation window (docs/insights/burst_detector_
methodology.md explains why) — precision, recall, lead-time, and the
precision × recall curve across `Z_SCORE_THRESHOLD` values, all split by
alert type (z-score "spike" vs CUSUM "regime_change").

This never touches Kafka/Redis/ClickHouse — pure replay over the CSV, so it
runs anywhere `assets/incidents.csv` and this package's deps are available,
cluster or no cluster.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from src.backtest_metrics import (
    Alert,
    BacktestSettings,
    chronological_split,
    evaluate_alerts,
    group_p1_p2_by_entity,
    precision_recall_curve,
)
from src.detector import (
    CUSUM_H,
    CUSUM_K,
    HISTORY_LENGTH,
    WINDOWS_SECONDS,
    Z_SCORE_THRESHOLD,
    CusumState,
    robust_std_from_mad,
    robust_z_score,
    update_cusum,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DATASET = REPO_ROOT / "assets" / "incidents.csv"

SETTINGS = BacktestSettings()


@dataclass
class _BucketState:
    bucket_id: int | None = None
    count: int = 0
    history: list[float] = field(default_factory=list)
    cusum: CusumState = field(default_factory=CusumState)


class InMemoryState:
    """Same bucket/history/CUSUM rollover semantics as `src.state.RedisState`,
    without Redis — a synchronous in-process stand-in built for replaying a
    static, already-sorted dataset."""

    def __init__(self) -> None:
        self._buckets: dict[tuple[str, str], _BucketState] = defaultdict(_BucketState)

    def record_event(
        self, entity_id: str, event_epoch: float, window_name: str, window_seconds: int
    ) -> tuple[int, list[float]]:
        state = self._buckets[(entity_id, window_name)]
        bucket_id = int(event_epoch // window_seconds)
        if state.bucket_id is not None and state.bucket_id != bucket_id:
            state.history.insert(0, state.count)
            del state.history[HISTORY_LENGTH:]
            state.count = 0
        state.bucket_id = bucket_id
        state.count += 1
        return state.count, list(state.history)

    def cusum_for(self, entity_id: str, window_name: str) -> CusumState:
        return self._buckets[(entity_id, window_name)].cusum

    def set_cusum(self, entity_id: str, window_name: str, cusum: CusumState) -> None:
        self._buckets[(entity_id, window_name)].cusum = cusum


def raise_alerts(df: pd.DataFrame, z_threshold: float = Z_SCORE_THRESHOLD) -> list[Alert]:
    state = InMemoryState()
    alerts: list[Alert] = []

    for row in df.itertuples():
        entity_id = row.item_configuracao or "unknown"
        opened_at: pd.Timestamp = row.aberto_em
        event_epoch = opened_at.timestamp()

        for window_name, window_seconds in WINDOWS_SECONDS.items():
            count, history = state.record_event(entity_id, event_epoch, window_name, window_seconds)
            z, median, mad = robust_z_score(count, history)
            robust_std = robust_std_from_mad(mad)

            triggered_spike = z > z_threshold

            cusum = state.cusum_for(entity_id, window_name)
            new_cusum, triggered_cusum = update_cusum(cusum, count, median, robust_std, CUSUM_K, CUSUM_H)
            state.set_cusum(entity_id, window_name, new_cusum)

            if triggered_spike or triggered_cusum:
                alert_type = "spike" if triggered_spike else "regime_change"
                alerts.append(Alert(entity_id, opened_at, alert_type, window_name))

    return alerts


def _print_window_report(name: str, df: pd.DataFrame) -> None:
    p1_p2 = df[df["prioridade_codigo"].isin([1, 2])]
    p1_p2_by_entity = group_p1_p2_by_entity(p1_p2, "item_configuracao", "aberto_em")

    alerts = raise_alerts(df)
    metrics = evaluate_alerts(
        alerts, p1_p2_by_entity, SETTINGS.min_lead_time_seconds, SETTINGS.lead_time_window_seconds
    )

    print(f"\n=== {name} window ({len(df):,} rows) ===")
    print(f"Total alerts: {metrics['total_alerts']:,}")
    print(f"P1/P2 incidents: {metrics['total_p1_p2']:,} (covered by an alert: {metrics['covered_p1_p2']:,})")
    print(f"Precision: {metrics['precision']:.3f}")
    print(f"Recall: {metrics['recall']:.3f}")
    print(f"Median lead time (true positives): {metrics['median_lead_time_seconds']:.0f}s")
    print("By alert type:")
    for alert_type, stats in metrics["by_alert_type"].items():
        print(
            f"  {alert_type}: {stats['total_alerts']:,} alerts, "
            f"precision={stats['precision']:.3f}, "
            f"median_lead_time={stats['median_lead_time_seconds']:.0f}s"
        )
    print("Top false-positive ICs:")
    for entity_id, count in metrics["false_positives_by_ic"].items():
        print(f"  {entity_id}: {count}")


def _print_curve(calibration_df: pd.DataFrame) -> None:
    p1_p2 = calibration_df[calibration_df["prioridade_codigo"].isin([1, 2])]
    p1_p2_by_entity = group_p1_p2_by_entity(p1_p2, "item_configuracao", "aberto_em")

    curve = precision_recall_curve(
        SETTINGS.curve_thresholds,
        lambda threshold: raise_alerts(calibration_df, threshold),
        p1_p2_by_entity,
        SETTINGS.min_lead_time_seconds,
        SETTINGS.lead_time_window_seconds,
    )

    print("\n=== Precision × recall curve (calibration window, by Z_SCORE_THRESHOLD) ===")
    print(f"{'threshold':>10} {'alerts':>8} {'precision':>10} {'recall':>8} {'lead_time_s':>12}")
    for point in curve:
        print(
            f"{point['z_score_threshold']:>10.1f} {point['total_alerts']:>8,} "
            f"{point['precision']:>10.3f} {point['recall']:>8.3f} "
            f"{np.nan_to_num(point['median_lead_time_seconds']):>12.0f}"
        )


def main() -> None:
    df = pd.read_csv(DATASET, usecols=["item_configuracao", "aberto_em", "prioridade_codigo"])
    df["aberto_em"] = pd.to_datetime(df["aberto_em"])
    df = df.sort_values("aberto_em").reset_index(drop=True)

    calibration_df, evaluation_df = chronological_split(df, "aberto_em", SETTINGS.calibration_fraction)

    print(f"Rows replayed: {len(df):,}")
    print(f"Min lead time floor: {SETTINGS.min_lead_time_seconds}s (N1's 15-minute escalation window)")
    print(f"Lead time window: {SETTINGS.lead_time_window_seconds}s")

    _print_window_report("calibration", calibration_df)
    _print_window_report("evaluation", evaluation_df)
    _print_curve(calibration_df)


if __name__ == "__main__":
    main()
