from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
from evidently import Report
from evidently.metrics import ValueDrift

# Standard PSI reading: <0.1 no material shift, 0.1-0.25 moderate, >0.25
# significant — https://en.wikipedia.org/wiki/Population_stability_index is
# the same formula every vendor tool (Evidently included) implements.
PSI_SIGNIFICANT_THRESHOLD = 0.25


@dataclass(frozen=True)
class DriftResult:
    psi: float
    # KS only applies to continuous distributions — None for categorical
    # features (owner, priority_group). Evidently's "ks" method
    # reports the test's p-value, not the D statistic — small means drift.
    ks_pvalue: float | None


def compute_drift(
    reference: pd.DataFrame,
    current: pd.DataFrame,
    feature_columns: list[str],
) -> dict[str, DriftResult]:
    """PSI (+ KS p-value for numeric columns) per feature between two windows
    of the same feature frame, via Evidently AI's `Report`/`ValueDrift` —
    `reference` is the Production model's training window, `current` is
    whatever the marts hold now. Pure/no I/O beyond Evidently's own
    computation, so it runs against synthetic distributions in tests without
    MLflow or ClickHouse (see drift/run.py for the window that feeds this in
    production)."""
    numeric_columns = {column for column in feature_columns if pd.api.types.is_numeric_dtype(reference[column])}

    metrics = [ValueDrift(column=column, method="psi") for column in feature_columns]
    metrics += [ValueDrift(column=column, method="ks") for column in feature_columns if column in numeric_columns]

    snapshot = Report(metrics=metrics).run(reference_data=reference, current_data=current)
    values = [metric["value"] for metric in snapshot.dict()["metrics"]]

    psi_values = dict(zip(feature_columns, values[: len(feature_columns)]))
    ks_pvalues = dict(zip((c for c in feature_columns if c in numeric_columns), values[len(feature_columns) :]))

    return {
        column: DriftResult(psi=float(psi_values[column]), ks_pvalue=ks_pvalues.get(column))
        for column in feature_columns
    }
