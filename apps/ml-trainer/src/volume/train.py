from __future__ import annotations

import logging
from pathlib import Path

import lightgbm as lgb
import mlflow
import numpy as np
import pandas as pd
from prophet import Prophet
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error

from model_names import registered_model_name
from settings import Settings
from split import temporal_split
from volume import features
from volume.data import write_volume_forecast
from volume.model import VolumeForecastModel

HORIZONS = (1, 7)
ENSEMBLE_WEIGHT_GRID = np.round(np.arange(0.0, 1.01, 0.1), 2)

LOGGER = logging.getLogger(__name__)


def train_prophet_per_series(train_long: pd.DataFrame) -> dict[str, Prophet]:
    """One Prophet model per `priority_group`, trained on that series' own
    history only — Prophet has no notion of a shared categorical feature."""
    models = {}
    for group in sorted(train_long["priority_group"].unique()):
        series = (
            train_long.loc[train_long["priority_group"] == group, ["date", "count"]]
            .rename(columns={"date": "ds", "count": "y"})
            .sort_values("ds")
        )
        model = Prophet(
            weekly_seasonality=True,
            yearly_seasonality=False,
            daily_seasonality=False,
            interval_width=0.8,
        )
        model.fit(series)
        models[group] = model
    return models


def predict_prophet(models: dict[str, Prophet], eval_long: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """Predict, for each row's own date + horizon, the target day's count."""
    rows = []
    for group, model in models.items():
        group_df = eval_long.loc[eval_long["priority_group"] == group]
        if group_df.empty:
            continue
        future = pd.DataFrame({"ds": group_df["date"] + pd.Timedelta(days=horizon)})
        forecast = model.predict(future)
        rows.append(
            pd.DataFrame(
                {
                    "date": group_df["date"].values,
                    "priority_group": group,
                    "prophet_pred": forecast["yhat"].values,
                    "prophet_lower": forecast["yhat_lower"].values,
                    "prophet_upper": forecast["yhat_upper"].values,
                }
            )
        )
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def train_lightgbm(train_frame: pd.DataFrame, target_column: str) -> lgb.LGBMRegressor:
    x = train_frame[features.FEATURE_COLUMNS].copy()
    x["priority_group"] = x["priority_group"].astype("category")
    y = train_frame[target_column]
    model = lgb.LGBMRegressor(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=15,
        min_child_samples=5,
        random_state=42,
        verbosity=-1,
    )
    model.fit(x, y, categorical_feature=["priority_group"])
    return model


def _best_ensemble_weight(actual: np.ndarray, prophet_pred: np.ndarray, lgb_pred: np.ndarray) -> float:
    """Grid search the Prophet/LightGBM blend weight that minimizes MAE on
    validation. `weight` is Prophet's share of the ensemble."""
    best_weight, best_mae = 0.5, np.inf
    for weight in ENSEMBLE_WEIGHT_GRID:
        blended = weight * prophet_pred + (1 - weight) * lgb_pred
        mae = mean_absolute_error(actual, blended)
        if mae < best_mae:
            best_mae, best_weight = mae, weight
    return float(best_weight)


def _mape_by_priority(df: pd.DataFrame, actual_col: str, pred_col: str) -> dict[str, float]:
    return {
        group: float(mean_absolute_percentage_error(g[actual_col], g[pred_col]))
        for group, g in df.groupby("priority_group")
    }


def _ci80_coverage(actual: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> float:
    return float(np.mean((actual >= lower) & (actual <= upper)))


def train_horizon(daily: pd.DataFrame, long_df: pd.DataFrame, settings: Settings, horizon: int) -> dict:
    long_split = temporal_split(long_df, "date", settings.train_end, settings.validation_end, settings.holdout_end)
    feature_frame = features.build_feature_frame(daily, horizon)
    feat_split = temporal_split(
        feature_frame, "date", settings.train_end, settings.validation_end, settings.holdout_end
    )
    target_column = f"target_d{horizon}"

    prophet_models = train_prophet_per_series(long_split.train)
    lgb_model = train_lightgbm(feat_split.train, target_column)

    def _evaluate(feat_subset: pd.DataFrame) -> pd.DataFrame:
        prophet_pred = predict_prophet(prophet_models, feat_subset, horizon)
        x = feat_subset[features.FEATURE_COLUMNS].copy()
        x["priority_group"] = x["priority_group"].astype("category")
        merged = feat_subset[["date", "priority_group", target_column]].merge(
            prophet_pred, on=["date", "priority_group"], how="inner"
        )
        merged["lgb_pred"] = lgb_model.predict(x)
        return merged

    val_eval = _evaluate(feat_split.validation)
    weight = _best_ensemble_weight(
        val_eval[target_column].to_numpy(),
        val_eval["prophet_pred"].to_numpy(),
        val_eval["lgb_pred"].to_numpy(),
    )

    holdout_eval = _evaluate(feat_split.holdout)
    holdout_eval["ensemble_pred"] = (
        weight * holdout_eval["prophet_pred"] + (1 - weight) * holdout_eval["lgb_pred"]
    ).clip(lower=0)

    metrics = {
        "mape_by_priority_ensemble": _mape_by_priority(holdout_eval, target_column, "ensemble_pred"),
        "mape_by_priority_prophet": _mape_by_priority(holdout_eval, target_column, "prophet_pred"),
        "mape_by_priority_lgb": _mape_by_priority(holdout_eval, target_column, "lgb_pred"),
        "mae_ensemble": float(mean_absolute_error(holdout_eval[target_column], holdout_eval["ensemble_pred"])),
        "mae_prophet": float(mean_absolute_error(holdout_eval[target_column], holdout_eval["prophet_pred"])),
        "mae_lgb": float(mean_absolute_error(holdout_eval[target_column], holdout_eval["lgb_pred"])),
        "ci80_coverage": _ci80_coverage(
            holdout_eval[target_column].to_numpy(),
            holdout_eval["prophet_lower"].to_numpy(),
            holdout_eval["prophet_upper"].to_numpy(),
        ),
        "ensemble_weight_prophet": weight,
    }

    return {
        "prophet_models": prophet_models,
        "lgb_model": lgb_model,
        "weight": weight,
        "metrics": metrics,
    }


def tenants_with_history(daily: pd.DataFrame, min_history_days: int) -> list[str]:
    """Tenants discovered from the mart, never from configuration: adding a
    client must not require editing anything here. One without enough history
    is skipped with a log, not failed."""
    history = daily.groupby("tenant_id")["date"].nunique()
    eligible = sorted(history[history >= min_history_days].index)
    for tenant_id in sorted(set(history.index) - set(eligible)):
        LOGGER.info(
            "volume: skipping tenant=%s, %d days of history (< %d)",
            tenant_id,
            history[tenant_id],
            min_history_days,
        )
    return eligible


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


def train_and_log(settings: Settings, daily: pd.DataFrame, dataset_version: str | None = None) -> str:
    """A set of models per tenant, never one across all of them: two operations
    have different seasonality, severity mix and base volume, and a shared model
    learns the weighted average — worst exactly for the smaller client, where
    the relative error hurts most.

    One tenant failing does not cost the others; the parent run records which
    ones trained.
    """
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    tenants = _requested_tenants(settings, tenants_with_history(daily, settings.tenant_min_history_days))
    trained: dict[str, str] = {}
    failed: dict[str, str] = {}

    with mlflow.start_run() as parent:
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("tenants", ",".join(tenants))
        for tenant_id in tenants:
            try:
                trained[tenant_id] = train_tenant(
                    settings, daily[daily["tenant_id"] == tenant_id], tenant_id, dataset_version
                )
            except Exception as exc:
                LOGGER.exception("volume: tenant=%s failed", tenant_id)
                failed[tenant_id] = str(exc)
        mlflow.log_param("tenants_trained", ",".join(trained))
        mlflow.log_param("tenants_failed", ",".join(failed))
        mlflow.log_metric("tenants_trained_count", len(trained))
        return parent.info.run_id


def train_tenant(
    settings: Settings, daily: pd.DataFrame, tenant_id: str, dataset_version: str | None = None
) -> str:
    """Both horizons for one tenant, logged as a nested run and registered
    under a name carrying the tenant so inference can resolve which to serve."""
    registered_name = registered_model_name(settings.mlflow_registered_model_name, tenant_id)

    long_df = features.to_long_format(daily)

    results = {horizon: train_horizon(daily, long_df, settings, horizon) for horizon in HORIZONS}

    with mlflow.start_run(nested=True, run_name=tenant_id) as run:
        mlflow.log_param("tenant_id", tenant_id)
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("train_end", settings.train_end)
        mlflow.log_param("validation_end", settings.validation_end)
        mlflow.log_param("holdout_end", settings.holdout_end)

        lgb_bumped_prophet = True
        for horizon, result in results.items():
            metrics = result["metrics"]
            mlflow.log_param(f"d{horizon}_ensemble_weight_prophet", result["weight"])
            mlflow.log_metric(f"d{horizon}_mae_ensemble", metrics["mae_ensemble"])
            mlflow.log_metric(f"d{horizon}_mae_prophet", metrics["mae_prophet"])
            mlflow.log_metric(f"d{horizon}_mae_lgb", metrics["mae_lgb"])
            mlflow.log_metric(f"d{horizon}_ci80_coverage", metrics["ci80_coverage"])
            for group, mape in metrics["mape_by_priority_ensemble"].items():
                mlflow.log_metric(f"d{horizon}_mape_{group}", mape)
            lgb_bumped_prophet = lgb_bumped_prophet and (metrics["mae_lgb"] <= metrics["mae_prophet"])

        mlflow.log_param("lgb_beats_prophet_holdout", lgb_bumped_prophet)

        bundled_model = VolumeForecastModel(
            lgb_models={h: r["lgb_model"] for h, r in results.items()},
            prophet_models={h: r["prophet_models"] for h, r in results.items()},
            ensemble_weights={h: r["weight"] for h, r in results.items()},
        )
        mlflow.pyfunc.log_model(
            name="model",
            python_model=bundled_model,
            # VolumeForecastModel.predict() calls back into volume.features — both
            # need to travel with the artifact. This app's own entrypoint runs
            # from inside src/ (see Dockerfile) so the class pickles as
            # volume.model.VolumeForecastModel, not src.volume.model — a serving
            # process with its own top-level `src` package (ml-model-serving)
            # would otherwise shadow the bundled code and fail to unpickle it.
            code_paths=[str(Path(__file__).resolve().parent)],
            registered_model_name=registered_name if settings.auto_promote else None,
        )

        run_id = run.info.run_id

    _forecast_and_write(settings, long_df, bundled_model, tenant_id)

    if settings.auto_promote:
        promote_latest(settings, run_id, registered_name)

    return run_id


def _forecast_and_write(
    settings: Settings, long_df: pd.DataFrame, bundled_model: VolumeForecastModel, tenant_id: str
) -> None:
    """D+1/D+7 forecast as of the latest date in `long_df`, one row per
    `priority_group`, using the same lag/rolling feature computation as
    training — `VolumeForecastModel.predict` expects those precomputed on
    `model_input`, the same contract `ml-model-serving` calls at inference
    time, kept in sync by construction."""
    as_of_date = long_df["date"].max()
    featured = features.add_lag_features(long_df)
    latest = featured.loc[featured["date"] == as_of_date].reset_index(drop=True)

    predictions = bundled_model.predict(None, latest)

    rows = [
        {
            "tenant_id": tenant_id,
            "target_date": (as_of_date + pd.Timedelta(days=int(row["horizon"]))).date(),
            "priority_group": row["priority_group"],
            "horizon": int(row["horizon"]),
            "yhat": float(row["yhat"]),
            "yhat_lower": float(row["yhat_lower"]),
            "yhat_upper": float(row["yhat_upper"]),
        }
        for _, row in predictions.iterrows()
    ]
    write_volume_forecast(settings, rows)


def promote_latest(settings: Settings, run_id: str, registered_name: str | None = None) -> None:
    name = registered_name or settings.mlflow_registered_model_name
    client = mlflow.MlflowClient(tracking_uri=settings.mlflow_tracking_uri)
    versions = client.search_model_versions(f"name='{name}'")
    matching = [v for v in versions if v.run_id == run_id]
    if not matching:
        LOGGER.warning("No registered model version found for run %s — skipping promotion.", run_id)
        return
    version = matching[0].version
    client.transition_model_version_stage(
        name=name,
        version=version,
        stage="Production",
        archive_existing_versions=True,
    )
    LOGGER.info("Promoted %s v%s (run %s) to Production.", settings.mlflow_registered_model_name, version, run_id)
