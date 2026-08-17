"""Backtest the burst detector against the real historical dataset.

Usage: uv run --package ops-ahead-ml-burst-detector python scripts/backtest.py

Replays assets/incidents.csv (real ITSM history, chronological) through the
exact same detection algorithm the live consumer uses (src/detector.py), with
an in-memory state stand-in for Redis, and measures:

  - precision: of all alerts raised, what fraction are followed by an actual
    P1/P2 at the same IC within LEAD_TIME_WINDOW_SECONDS?
  - median lead time: for alerts that *were* followed by a P1/P2, how far
    ahead did the alert fire?
  - false positives per IC: alerts not followed by a P1/P2 at that IC.

This never touches Kafka/Redis/ClickHouse — pure replay over the CSV, so it
runs anywhere `assets/incidents.csv` and this package's deps are available,
cluster or no cluster.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

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

# An alert "predicts" an escalation if a P1/P2 at the same IC follows within
# this many seconds of the alert firing.
LEAD_TIME_WINDOW_SECONDS = 3600


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


@dataclass
class Alert:
    entity_id: str
    detected_at: pd.Timestamp
    alert_type: str
    window_name: str


def raise_alerts(df: pd.DataFrame) -> list[Alert]:
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

            triggered_spike = z > Z_SCORE_THRESHOLD

            cusum = state.cusum_for(entity_id, window_name)
            new_cusum, triggered_cusum = update_cusum(cusum, count, median, robust_std, CUSUM_K, CUSUM_H)
            state.set_cusum(entity_id, window_name, new_cusum)

            if triggered_spike or triggered_cusum:
                alert_type = "spike" if triggered_spike else "regime_change"
                alerts.append(Alert(entity_id, opened_at, alert_type, window_name))

    return alerts


def evaluate(df: pd.DataFrame, alerts: list[Alert]) -> dict:
    p1_p2 = df[df["prioridade_codigo"].isin([1, 2])][["item_configuracao", "aberto_em"]].sort_values("aberto_em")
    by_entity: dict[str, list[pd.Timestamp]] = defaultdict(list)
    for entity_id, opened_at in p1_p2.itertuples(index=False):
        by_entity[entity_id or "unknown"].append(opened_at)

    lead_times: list[float] = []
    false_positives_by_ic: dict[str, int] = defaultdict(int)
    true_positives = 0

    for alert in alerts:
        window_end = alert.detected_at + pd.Timedelta(seconds=LEAD_TIME_WINDOW_SECONDS)
        candidates = [
            t for t in by_entity.get(alert.entity_id, []) if alert.detected_at < t <= window_end
        ]
        if candidates:
            true_positives += 1
            lead_times.append((min(candidates) - alert.detected_at).total_seconds())
        else:
            false_positives_by_ic[alert.entity_id] += 1

    total_alerts = len(alerts)
    precision = true_positives / total_alerts if total_alerts else float("nan")
    median_lead_time = statistics.median(lead_times) if lead_times else float("nan")

    return {
        "total_alerts": total_alerts,
        "true_positives": true_positives,
        "precision": precision,
        "median_lead_time_seconds": median_lead_time,
        "false_positives_by_ic": dict(
            sorted(false_positives_by_ic.items(), key=lambda kv: -kv[1])[:20]
        ),
    }


def main() -> None:
    df = pd.read_csv(DATASET, usecols=["item_configuracao", "aberto_em", "prioridade_codigo"])
    df["aberto_em"] = pd.to_datetime(df["aberto_em"])
    df = df.sort_values("aberto_em").reset_index(drop=True)

    alerts = raise_alerts(df)
    results = evaluate(df, alerts)

    print(f"Rows replayed: {len(df):,}")
    print(f"Total alerts: {results['total_alerts']:,}")
    print(f"True positives: {results['true_positives']:,}")
    print(f"Precision: {results['precision']:.3f}")
    print(f"Median lead time before P1/P2: {results['median_lead_time_seconds']:.0f}s")
    print("Top false-positive ICs:")
    for entity_id, count in results["false_positives_by_ic"].items():
        print(f"  {entity_id}: {count}")


if __name__ == "__main__":
    main()
