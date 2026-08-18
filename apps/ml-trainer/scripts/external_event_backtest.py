"""Backtest the external-event (Isolation Forest) detector against the real
historical dataset.

Usage: uv run --package ops-ahead-ml-trainer python scripts/external_event_backtest.py

Replays assets/incidents.csv into the same daily feature shape the live
detector trains on (src/external_event/features.py), fits an Isolation
Forest on it, and measures recall/precision/false-positive-rate against a
"known outliers" reference built independently from the same CSV — no
externally-labeled ground truth exists in this dataset (see
docs/insights/ml_models_baseline.md for results and the September/2025
sanity check against docs/insights/03-mentoria-insights.md).

Pure replay over the CSV — no ClickHouse/MLflow — same shape as
apps/ml-burst-detector/scripts/backtest.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

from external_event.features import FEATURE_COLUMNS
from external_event.train import fit_isolation_forest

REPO_ROOT = Path(__file__).resolve().parents[3]
# The historical base is read through the repo-level reader so the origin's
# vocabulary stays confined to it (domain/acl/itsm.md).
sys.path.insert(0, str(REPO_ROOT / "scripts"))
import historical_dataset  # noqa: E402

Z_SCORE_THRESHOLD = 3.5
CONTAMINATION = 0.05
ROLLING_WINDOW_DAYS = 60
ROLLING_MIN_PERIODS = 30


def build_daily_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["date"] = df["opened_at"].dt.floor("D")

    daily = df.groupby("date").agg(
        total_incidents=("ticket_number", "count"),
        p1_count=("severity", lambda s: (s == 1).sum()),
        manual_open_count=("opened_by", lambda s: (s == "manual").sum()),
        no_intervention_count=("status", lambda s: (s == "no_intervention").sum()),
        unique_entities=("entity_id", "nunique"),
    )
    daily["p1_share"] = daily["p1_count"] / daily["total_incidents"]
    daily["manual_open_share"] = daily["manual_open_count"] / daily["total_incidents"]
    daily["no_intervention_share"] = daily["no_intervention_count"] / daily["total_incidents"]

    return daily.reset_index()[["date", *FEATURE_COLUMNS]]


def known_outliers(daily: pd.DataFrame) -> pd.Series:
    """Days whose total-volume robust z-score, against a *trailing* window
    of recent history (not the full dataset), crosses Z_SCORE_THRESHOLD — a
    global median/MAD would read the dataset's overall volume trend as
    anomalies in every later period. The day itself is excluded from its
    own baseline (`shift(1)`), same no-self-leakage rule as
    `breach/features.add_historical_group_severity_features`."""
    counts = daily["total_incidents"]
    history = counts.shift(1)

    rolling_median = history.rolling(window=ROLLING_WINDOW_DAYS, min_periods=ROLLING_MIN_PERIODS).median()
    rolling_mad = history.rolling(window=ROLLING_WINDOW_DAYS, min_periods=ROLLING_MIN_PERIODS).apply(
        lambda w: np.median(np.abs(w - np.median(w))), raw=True
    )
    robust_std = np.maximum(1.4826 * rolling_mad, 1.0)
    z = (counts - rolling_median) / robust_std
    return (z > Z_SCORE_THRESHOLD).fillna(False)


def evaluate(daily: pd.DataFrame, flagged: pd.Series, reference: pd.Series) -> dict:
    true_positives = int((flagged & reference).sum())
    false_positives = int((flagged & ~reference).sum())
    total_reference = int(reference.sum())
    total_flagged = int(flagged.sum())
    total_normal = int((~reference).sum())

    recall = true_positives / total_reference if total_reference else float("nan")
    precision = true_positives / total_flagged if total_flagged else float("nan")
    false_positive_rate = false_positives / total_normal if total_normal else float("nan")

    return {
        "total_days": len(daily),
        "known_outlier_days": total_reference,
        "flagged_days": total_flagged,
        "true_positives": true_positives,
        "recall": recall,
        "precision": precision,
        "false_positive_rate": false_positive_rate,
    }


def main() -> None:
    df = historical_dataset.load(
        ["ticket_number", "opened_at", "severity", "status", "opened_by", "entity_id"]
    )

    daily = build_daily_features(df)
    reference = known_outliers(daily)

    model = fit_isolation_forest(daily, CONTAMINATION)
    predictions = model.predict(daily[FEATURE_COLUMNS])
    flagged = pd.Series(predictions == -1, index=daily.index)

    results = evaluate(daily, flagged, reference)

    print(f"Days replayed: {results['total_days']:,}")
    print(f"Known-outlier days (z-score reference): {results['known_outlier_days']}")
    print(f"Flagged days (Isolation Forest): {results['flagged_days']}")
    print(f"True positives: {results['true_positives']}")
    print(f"Recall: {results['recall']:.3f}")
    print(f"Precision: {results['precision']:.3f}")
    print(f"False positive rate (normal days): {results['false_positive_rate']:.3f}")
    print("Known-outlier dates:")
    for date in daily.loc[reference, "date"]:
        print(f"  {date.date()}")
    print("Isolation Forest flagged dates:")
    for date in daily.loc[flagged, "date"]:
        print(f"  {date.date()}")


if __name__ == "__main__":
    main()
