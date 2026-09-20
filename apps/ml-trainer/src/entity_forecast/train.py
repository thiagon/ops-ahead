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
    """One model over every series, with the series as a categorical feature.

    A model per series would fit noise on the thin ones and learn the weekly
    shape hundreds of times over; sharing it lets a low-volume product borrow
    the pattern the busy ones establish.
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
    trends: pd.DataFrame, settings: Settings, results: dict[int, dict]
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
            tenant_id, category, product = str(row["priority_group"]).split("|", 2)
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


def train_and_log(settings: Settings, trends: pd.DataFrame, dataset_version: str | None = None) -> str:
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    results = {h: train_horizon(trends, settings, h) for h in HORIZONS}

    with mlflow.start_run() as run:
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("train_end", settings.train_end)
        mlflow.log_param("validation_end", settings.validation_end)
        mlflow.log_param("holdout_end", settings.holdout_end)
        mlflow.log_param("min_history_days", settings.entity_min_history_days)

        for horizon, result in results.items():
            mlflow.log_metric(f"d{horizon}_mae", result["metrics"]["mae"])
            mlflow.log_metric(f"d{horizon}_series_count", result["series_count"])

        run_id = run.info.run_id

    rows = _forecast_rows(trends, settings, results)
    if rows:
        write_entity_forecast(settings, rows)
    LOGGER.info("entity_forecast: wrote %d forecast rows", len(rows))
    return run_id
