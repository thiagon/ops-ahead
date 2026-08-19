from __future__ import annotations

import logging

import mlflow
import pandas as pd

from drift.monitor import PSI_SIGNIFICANT_THRESHOLD, DriftResult, compute_drift
from settings import Settings
from trigger import EXPERIMENT_NAMES

LOGGER = logging.getLogger(__name__)


def _production_train_end(client: mlflow.MlflowClient, registered_model_name: str) -> str:
    try:
        versions = client.get_latest_versions(registered_model_name, stages=["Production"])
    except mlflow.exceptions.MlflowException:
        versions = []
    if not versions:
        raise ValueError(f"{registered_model_name} has no Production version — nothing to compare drift against.")
    run = client.get_run(versions[0].run_id)
    train_end = run.data.params.get("train_end")
    if train_end is None:
        raise ValueError(
            f"{registered_model_name}/Production run {versions[0].run_id} has no 'train_end' param logged."
        )
    return train_end


def _split_reference_current(
    frame: pd.DataFrame, date_column: str, train_end: str
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Two-way split at the Production model's own training cutoff — everything
    up to `train_end` is what it trained on, everything after is what it has
    actually been serving against. Deliberately not `split.temporal_split`:
    that enforces three non-empty partitions (train/validation/holdout) for a
    training run; drift only needs two, and an empty `current` window is a
    real, reportable state (no data has accrued since promotion yet), not a
    bug to raise past."""
    dates = pd.to_datetime(frame[date_column])
    if dates.dt.tz is not None:
        dates = dates.dt.tz_localize(None)
    train_end_ts = pd.Timestamp(train_end)

    reference = frame.loc[dates <= train_end_ts]
    current = frame.loc[dates > train_end_ts]
    if reference.empty or current.empty:
        raise ValueError(
            f"drift split at train_end={train_end!r} produced an empty window "
            f"(reference={len(reference)} rows, current={len(current)} rows) — "
            "no production data has accrued since this model was promoted yet."
        )
    return reference, current


def _log_domain_drift(domain: str, results: dict[str, DriftResult]) -> None:
    for feature, result in results.items():
        mlflow.log_metric(f"{domain}_{feature}_psi", result.psi)
        if result.ks_pvalue is not None:
            mlflow.log_metric(f"{domain}_{feature}_ks_pvalue", result.ks_pvalue)


def run_drift_monitoring(
    settings: Settings,
    domains: dict[str, tuple[pd.DataFrame, str, list[str]]],
) -> dict:
    """PSI/KS between each Production model's training window and the marts'
    current window. `domains` maps a domain name (e.g. "volume", "breach") to
    `(feature_frame, date_column, feature_columns)` — main.py assembles this
    from each domain's own data/features modules so this function stays free
    of ClickHouse I/O and is unit-testable with synthetic frames."""
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)
    client = mlflow.MlflowClient(tracking_uri=settings.mlflow_tracking_uri)

    all_results: dict[str, dict[str, DriftResult]] = {}
    with mlflow.start_run() as run:
        for domain, (frame, date_column, feature_columns) in domains.items():
            train_end = _production_train_end(client, EXPERIMENT_NAMES[domain])
            reference, current = _split_reference_current(frame, date_column, train_end)

            results = compute_drift(reference, current, feature_columns)
            all_results[domain] = results

            mlflow.log_param(f"{domain}_train_end", train_end)
            mlflow.log_param(f"{domain}_reference_rows", len(reference))
            mlflow.log_param(f"{domain}_current_rows", len(current))
            _log_domain_drift(domain, results)

            for feature, result in results.items():
                significant = result.psi > PSI_SIGNIFICANT_THRESHOLD
                LOGGER.info(
                    "drift domain=%s feature=%s psi=%.4f significant=%s",
                    domain,
                    feature,
                    result.psi,
                    significant,
                )

        run_id = run.info.run_id

    return {"run_id": run_id, "results": all_results}
