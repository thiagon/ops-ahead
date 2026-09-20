from __future__ import annotations

import logging

import lightgbm as lgb
import mlflow
import numpy as np
import pandas as pd

from entity_forecast import features
from entity_forecast.data import write_entity_forecast
from settings import Settings
from split import temporal_split

LOGGER = logging.getLogger(__name__)

HORIZONS = (1, 7)


def train_lightgbm(train_frame: pd.DataFrame, target_column: str) -> lgb.LGBMRegressor:
    """One model over one tenant's series, with the series as a categorical
    feature.

    Per series it would fit noise on the thin ones and learn the weekly shape
    hundreds of times over; sharing it inside the tenant lets a low-volume
    product borrow the pattern the busy ones establish. Sharing it *across*
    tenants would instead have one client's seasonality explain another's,
    which is what the tenant being part of the grain exists to prevent.
    """
    x = train_frame[features.FEATURE_COLUMNS].copy()
    x["priority_group"] = x["priority_group"].astype("category")
    model = lgb.LGBMRegressor(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        min_child_samples=5,
        random_state=42,
        verbosity=-1,
    )
    model.fit(x, train_frame[target_column], categorical_feature=["priority_group"])
    return model


def _mae(actual: np.ndarray, predicted: np.ndarray) -> float:
    return float(np.mean(np.abs(actual - predicted)))


def _predict(model: lgb.LGBMRegressor, frame: pd.DataFrame, categories: pd.Index) -> np.ndarray:
    x = frame[features.FEATURE_COLUMNS].copy()
    # The same category set the model was fitted with: an unseen series would
    # otherwise shift the integer codes LightGBM reads and quietly predict for
    # the wrong one.
    x["priority_group"] = pd.Categorical(x["priority_group"], categories=categories)
    return model.predict(x)


def tenants_with_history(trends: pd.DataFrame, min_history_days: int) -> list[str]:
    """Tenants discovered from the mart, never from configuration: adding a
    client must not require editing anything here. One without enough history
    is skipped with a log, not failed."""
    history = trends.groupby("tenant_id")["date"].nunique()
    eligible = sorted(history[history >= min_history_days].index)
    for tenant_id in sorted(set(history.index) - set(eligible)):
        LOGGER.info(
            "entity_forecast: skipping tenant=%s, %d days of history (< %d)",
            tenant_id,
            history[tenant_id],
            min_history_days,
        )
    return eligible


def train_horizon(trends: pd.DataFrame, settings: Settings, horizon: int) -> dict:
    frame = features.build_feature_frame(trends, horizon, settings.entity_min_history_days)
    split = temporal_split(
        frame, "date", settings.train_end, settings.validation_end, settings.holdout_end
    )
    target_column = f"target_d{horizon}"

    model = train_lightgbm(split.train, target_column)
    categories = pd.Categorical(split.train["priority_group"]).categories

    holdout = split.holdout
    predicted = _predict(model, holdout, categories)
    residual_std = float(np.std(holdout[target_column].to_numpy() - predicted)) if len(holdout) else 0.0

    return {
        "model": model,
        "categories": categories,
        "series_count": int(frame["priority_group"].nunique()),
        "residual_std": residual_std,
        "metrics": {
            "mae": _mae(holdout[target_column].to_numpy(), predicted) if len(holdout) else float("nan"),
        },
    }


def _forecast_rows(
    trends: pd.DataFrame, settings: Settings, results: dict[int, dict], tenant_id: str
) -> list[dict]:
    """The last observable day of each series, projected forward — the row the
    dashboard reads, not an MLflow artifact."""
    rows: list[dict] = []
    for horizon, result in results.items():
        frame = features.build_feature_frame(trends, horizon, settings.entity_min_history_days)
        if frame.empty:
            continue
        latest = frame.sort_values("date").groupby("priority_group", as_index=False).tail(1)
        predicted = _predict(result["model"], latest, result["categories"])
        spread = 1.2816 * result["residual_std"]
        for (_, row), yhat in zip(latest.iterrows(), predicted, strict=True):
            category, product = str(row["priority_group"]).split("|", 1)
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "target_date": row["target_date"].date(),
                    "category": category,
                    "product": product,
                    "horizon": horizon,
                    "yhat": float(yhat),
                    "yhat_lower": float(max(0.0, yhat - spread)),
                    "yhat_upper": float(yhat + spread),
                }
            )
    return rows


def train_tenant(settings: Settings, trends: pd.DataFrame, tenant_id: str, dataset_version: str | None) -> str:
    """One tenant's models, logged as a nested run and registered under a name
    carrying the tenant, so inference can resolve which one to serve."""
    results = {h: train_horizon(trends, settings, h) for h in HORIZONS}

    with mlflow.start_run(nested=True, run_name=tenant_id) as run:
        mlflow.log_param("tenant_id", tenant_id)
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("train_end", settings.train_end)
        mlflow.log_param("validation_end", settings.validation_end)
        mlflow.log_param("holdout_end", settings.holdout_end)
        mlflow.log_param("min_history_days", settings.entity_min_history_days)

        for horizon, result in results.items():
            mlflow.log_metric(f"d{horizon}_mae", result["metrics"]["mae"])
            mlflow.log_metric(f"d{horizon}_series_count", result["series_count"])

        run_id = run.info.run_id

    rows = _forecast_rows(trends, settings, results, tenant_id)
    if rows:
        write_entity_forecast(settings, rows)
    LOGGER.info("entity_forecast: tenant=%s wrote %d forecast rows", tenant_id, len(rows))
    return run_id


def _requested_tenants(settings: Settings, eligible: list[str]) -> list[str]:
    """`settings.tenant_id` narrows the run to one tenant — every training
    message carries it. It has to be eligible: asking for a tenant with too
    little history is an explicit error, not a silent no-op, because the
    caller asked for a model and would otherwise get none without being told.
    """
    if settings.tenant_id is None:
        return eligible
    if settings.tenant_id not in eligible:
        raise ValueError(
            f"tenant {settings.tenant_id!r} has no trainable history"
        )
    return [settings.tenant_id]


def train_and_log(settings: Settings, trends: pd.DataFrame, dataset_version: str | None = None) -> str:
    """A set of models per tenant, never one across all of them: two operations
    have different seasonality, severity mix and base volume, and a shared model
    learns the weighted average — worst exactly for the smaller client, where
    the relative error hurts most.

    One tenant failing does not cost the others; the parent run records which
    ones trained.
    """
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    tenants = _requested_tenants(settings, tenants_with_history(trends, settings.entity_min_history_days))
    trained: dict[str, str] = {}
    failed: dict[str, str] = {}

    with mlflow.start_run() as parent:
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("tenants", ",".join(tenants))
        for tenant_id in tenants:
            tenant_trends = trends[trends["tenant_id"] == tenant_id]
            try:
                trained[tenant_id] = train_tenant(
                    settings, tenant_trends, tenant_id, dataset_version
                )
            except Exception as exc:
                LOGGER.exception("entity_forecast: tenant=%s failed", tenant_id)
                failed[tenant_id] = str(exc)
        mlflow.log_param("tenants_trained", ",".join(trained))
        mlflow.log_param("tenants_failed", ",".join(failed))
        mlflow.log_metric("tenants_trained_count", len(trained))
        return parent.info.run_id
