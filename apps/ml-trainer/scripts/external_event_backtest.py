"""Backtest the external-event (Isolation Forest) detector against the real
historical dataset.

Usage: uv run --package ops-ahead-ml-trainer python scripts/external_event_backtest.py

Replays assets/incidents.csv (real ITSM history) into the same daily feature
shape the live detector trains on (src/external_event/features.py), fits an
Isolation Forest on it, and measures recall/precision/false-positive-rate
against a "known outliers" reference built independently from the same CSV
— days whose total-volume robust z-score (median + MAD, same method
apps/ml-burst-detector/src/detector.py uses) crosses a threshold. No
externally-labeled ground truth exists in this dataset, so this is the
objective reference available; it's checked against the one independent
fact known about the dataset — the September/2025 spike Douglas described
in the mentoria as a real, unexplained external event
(docs/insights/03-mentoria-insights.md) — to confirm it isn't just noise.

This never touches ClickHouse/MLflow — pure replay over the CSV, so it runs
anywhere assets/incidents.csv and this package's deps are available, cluster
or no cluster (same shape as apps/ml-burst-detector/scripts/backtest.py).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from src.external_event.features import FEATURE_COLUMNS
from src.external_event.train import fit_isolation_forest

REPO_ROOT = Path(__file__).resolve().parents[3]
DATASET = REPO_ROOT / "assets" / "incidents.csv"

Z_SCORE_THRESHOLD = 3.5
CONTAMINATION = 0.05
ROLLING_WINDOW_DAYS = 60
ROLLING_MIN_PERIODS = 30


def build_daily_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["date"] = df["aberto_em"].dt.floor("D")

    daily = df.groupby("date").agg(
        total_incidents=("numero", "count"),
        p1_count=("prioridade_codigo", lambda s: (s == 1).sum()),
        manual_open_count=("aberto_por", lambda s: (s == "Manual").sum()),
        sem_intervencao_count=("status", lambda s: (s == "Sem Intervenção").sum()),
        unique_entities=("item_configuracao", "nunique"),
    )
    daily["p1_share"] = daily["p1_count"] / daily["total_incidents"]
    daily["manual_open_share"] = daily["manual_open_count"] / daily["total_incidents"]
    daily["sem_intervencao_share"] = daily["sem_intervencao_count"] / daily["total_incidents"]

    return daily.reset_index()[["date", *FEATURE_COLUMNS]]


def known_outliers(daily: pd.DataFrame) -> pd.Series:
    """Days whose total-volume robust z-score, against a *trailing* window
    of recent history (not the full dataset), crosses Z_SCORE_THRESHOLD.

    A single global median/MAD over the whole ~1.8-year history mistakes the
    dataset's overall volume trend for anomalies in every later period —
    tried first, it flagged 19% of all days, clearly not "known outliers".
    A trailing window controls for that trend; the day itself is excluded
    from its own baseline (`shift(1)`), same no-self-leakage rule the rest
    of this codebase applies to expanding/rolling features
    (`breach/features.add_historical_group_severity_features`)."""
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
    df = pd.read_csv(
        DATASET,
        usecols=["numero", "aberto_em", "prioridade_codigo", "status", "aberto_por", "item_configuracao"],
    )
    df["aberto_em"] = pd.to_datetime(df["aberto_em"])

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
