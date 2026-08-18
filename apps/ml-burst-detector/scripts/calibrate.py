"""Grid search the burst detector's parameters on the calibration window only.

Usage: uv run --package ops-ahead-ml-burst-detector python scripts/calibrate.py

Sweeps Z_SCORE_THRESHOLD, CUSUM_K, CUSUM_H, MIN_ROBUST_STD, and which window(s)
feed detection, all against the calibration window `scripts/backtest.py`
already carves out (chronological, first 70%) — never the evaluation window,
which Phase 5's task is to check the chosen point on once, without retuning.

The usefulness floor (CalibrationSettings.usefulness_floor_*) is fixed before
this script is ever run against real results — see
docs/insights/burst_detector_calibration.md. Every floor/grid value is
env-overridable (CalibrationSettings/BacktestSettings below) instead of a
module constant, so a rerun with different values doesn't need a code edit.
"""

from __future__ import annotations

import itertools
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
import sys
from pathlib import Path

import pandas as pd
from pydantic_settings import BaseSettings, SettingsConfigDict

from src.backtest_metrics import Alert, BacktestSettings, chronological_split, evaluate_alerts, group_p1_p2_by_entity
from src.detector import HISTORY_LENGTH, WINDOWS_SECONDS, CusumState, median_absolute_deviation, update_cusum

REPO_ROOT = Path(__file__).resolve().parents[3]
# The historical base is read through the repo-level reader so the origin's
# vocabulary stays confined to it (domain/acl/itsm.md).
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import historical_dataset  # noqa: E402


class CalibrationSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)

    # Fixed before looking at any sweep result (task 5.2). The lead-time leg
    # of the floor is BacktestSettings.min_lead_time_seconds — one N1-window
    # value, not duplicated here.
    usefulness_floor_precision: float = 0.15
    usefulness_floor_recall: float = 0.10

    grid_z_score_threshold: list[float] = [2.5, 3.5, 4.5]
    grid_cusum_k: list[float] = [0.5, 1.0]
    grid_cusum_h: list[float] = [3.0, 5.0]
    grid_min_robust_std: list[float] = [1.0, 2.0]
    # Comma-joined window names per combination, e.g. "15m,1h,6h" or "15m".
    grid_windows: list[str] = ["15m,1h,6h", "15m", "1h", "6h"]


BACKTEST_SETTINGS = BacktestSettings()
CALIBRATION_SETTINGS = CalibrationSettings()

USEFULNESS_FLOOR = {
    "precision": CALIBRATION_SETTINGS.usefulness_floor_precision,
    "recall": CALIBRATION_SETTINGS.usefulness_floor_recall,
    "median_lead_time_seconds": BACKTEST_SETTINGS.min_lead_time_seconds,
}

GRID = {
    "z_score_threshold": CALIBRATION_SETTINGS.grid_z_score_threshold,
    "cusum_k": CALIBRATION_SETTINGS.grid_cusum_k,
    "cusum_h": CALIBRATION_SETTINGS.grid_cusum_h,
    "min_robust_std": CALIBRATION_SETTINGS.grid_min_robust_std,
    "windows": [tuple(w.split(",")) for w in CALIBRATION_SETTINGS.grid_windows],
}


@dataclass
class _BucketState:
    bucket_id: int | None = None
    count: int = 0
    history: list[float] = field(default_factory=list)
    cusum: CusumState = field(default_factory=CusumState)


class InMemoryState:
    def __init__(self) -> None:
        self._buckets: dict[tuple[str, str], _BucketState] = defaultdict(_BucketState)

    def record_event(self, entity_id, event_epoch, window_name, window_seconds):
        state = self._buckets[(entity_id, window_name)]
        bucket_id = int(event_epoch // window_seconds)
        if state.bucket_id is not None and state.bucket_id != bucket_id:
            state.history.insert(0, state.count)
            del state.history[HISTORY_LENGTH:]
            state.count = 0
        state.bucket_id = bucket_id
        state.count += 1
        return state.count, list(state.history)

    def cusum_for(self, entity_id, window_name):
        return self._buckets[(entity_id, window_name)].cusum

    def set_cusum(self, entity_id, window_name, cusum):
        self._buckets[(entity_id, window_name)].cusum = cusum


def _z_score(count: float, history: list[float], min_robust_std: float) -> tuple[float, float, float]:
    """Same shape as `src.detector.robust_z_score`, with `MIN_ROBUST_STD`
    exposed as a parameter instead of the module constant — needed to sweep
    it here without touching the live detector's own default."""
    if len(history) < 2:
        return 0.0, (history[0] if history else 0.0), 0.0
    median = statistics.median(history)
    mad = median_absolute_deviation(history, median)
    robust_std = max(1.4826 * mad, min_robust_std)
    return (count - median) / robust_std, median, robust_std


def raise_alerts(
    df: pd.DataFrame, z_score_threshold: float, cusum_k: float, cusum_h: float, min_robust_std: float, windows: tuple[str, ...]
) -> list[Alert]:
    state = InMemoryState()
    alerts: list[Alert] = []
    active_windows = {name: WINDOWS_SECONDS[name] for name in windows}

    for row in df.itertuples():
        entity_id = row.entity_id or "unknown"
        opened_at: pd.Timestamp = row.opened_at
        event_epoch = opened_at.timestamp()

        for window_name, window_seconds in active_windows.items():
            count, history = state.record_event(entity_id, event_epoch, window_name, window_seconds)
            z, median, robust_std = _z_score(count, history, min_robust_std)
            triggered_spike = z > z_score_threshold

            cusum = state.cusum_for(entity_id, window_name)
            new_cusum, triggered_cusum = update_cusum(cusum, count, median, robust_std, cusum_k, cusum_h)
            state.set_cusum(entity_id, window_name, new_cusum)

            if triggered_spike or triggered_cusum:
                alert_type = "spike" if triggered_spike else "regime_change"
                alerts.append(Alert(entity_id, opened_at, alert_type, window_name))

    return alerts


def meets_floor(metrics: dict) -> bool:
    return (
        metrics["precision"] >= USEFULNESS_FLOOR["precision"]
        and metrics["recall"] >= USEFULNESS_FLOOR["recall"]
        and metrics["median_lead_time_seconds"] >= USEFULNESS_FLOOR["median_lead_time_seconds"]
    )


def main() -> None:
    df = historical_dataset.load(["entity_id", "opened_at", "severity"])
    df = df.sort_values("opened_at").reset_index(drop=True)

    calibration_df, _ = chronological_split(df, "opened_at", BACKTEST_SETTINGS.calibration_fraction)
    p1_p2 = calibration_df[calibration_df["severity"].isin([1, 2])]
    p1_p2_by_entity = group_p1_p2_by_entity(p1_p2, "entity_id", "opened_at")

    combos = list(itertools.product(*GRID.values()))
    print(f"Sweeping {len(combos)} combinations on the calibration window ({len(calibration_df):,} rows)...")

    results = []
    for z_score_threshold, cusum_k, cusum_h, min_robust_std, windows in combos:
        alerts = raise_alerts(calibration_df, z_score_threshold, cusum_k, cusum_h, min_robust_std, windows)
        metrics = evaluate_alerts(
            alerts, p1_p2_by_entity, BACKTEST_SETTINGS.min_lead_time_seconds, BACKTEST_SETTINGS.lead_time_window_seconds
        )
        results.append(
            {
                "z_score_threshold": z_score_threshold,
                "cusum_k": cusum_k,
                "cusum_h": cusum_h,
                "min_robust_std": min_robust_std,
                "windows": windows,
                **metrics,
            }
        )

    qualifying = [r for r in results if meets_floor(r)]

    print(f"\n{len(qualifying)} / {len(results)} combinations meet the usefulness floor {USEFULNESS_FLOOR}\n")

    results_by_recall = sorted(results, key=lambda r: (-r["recall"] if r["recall"] == r["recall"] else 0, -r["precision"]))
    print("Top 10 by recall (regardless of floor):")
    header = f"{'z':>5} {'k':>5} {'h':>5} {'std':>5} {'windows':>20} {'alerts':>8} {'precision':>10} {'recall':>8} {'lead_s':>8}"
    print(header)
    for r in results_by_recall[:10]:
        lead = r["median_lead_time_seconds"]
        lead_str = f"{lead:.0f}" if lead == lead else "nan"
        print(
            f"{r['z_score_threshold']:>5.1f} {r['cusum_k']:>5.1f} {r['cusum_h']:>5.1f} {r['min_robust_std']:>5.1f} "
            f"{','.join(r['windows']):>20} {r['total_alerts']:>8,} {r['precision']:>10.3f} {r['recall']:>8.3f} {lead_str:>8}"
        )

    if qualifying:
        print("\nCombinations meeting the floor:")
        for r in qualifying:
            print(r)
    else:
        print("\nNo combination meets the floor.")


if __name__ == "__main__":
    main()
