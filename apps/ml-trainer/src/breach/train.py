from __future__ import annotations

import logging
from pathlib import Path

import lightgbm as lgb
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import mlflow
import numpy as np
import optuna
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, brier_score_loss

from src.breach import features
from src.breach.model import BreachRiskModel
from src.settings import Settings
from src.split import temporal_split

LOGGER = logging.getLogger(__name__)
optuna.logging.set_verbosity(optuna.logging.WARNING)

CATEGORICAL_COLUMNS = ["assignment_group"]


def _prepare_x(df: pd.DataFrame) -> pd.DataFrame:
    x = df[features.FEATURE_COLUMNS].copy()
    for col in CATEGORICAL_COLUMNS:
        x[col] = x[col].astype("category")
    return x


def _objective(trial: optuna.Trial, x_train, y_train, x_val, y_val) -> float:
    params = {
        "n_estimators": trial.suggest_int("n_estimators", 100, 500),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.3, log=True),
        "num_leaves": trial.suggest_int("num_leaves", 7, 63),
        "min_child_samples": trial.suggest_int("min_child_samples", 5, 50),
        "reg_alpha": trial.suggest_float("reg_alpha", 1e-3, 10.0, log=True),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 10.0, log=True),
    }
    model = lgb.LGBMClassifier(class_weight="balanced", random_state=42, verbosity=-1, **params)
    model.fit(x_train, y_train, categorical_feature=CATEGORICAL_COLUMNS)
    val_prob = model.predict_proba(x_val)[:, 1]
    return average_precision_score(y_val, val_prob)


def tune_and_train(train_df: pd.DataFrame, validation_df: pd.DataFrame, n_trials: int):
    """Optuna search on validation AUC-PR (`class_weight='balanced'` fixes the
    ~1% breach rate's class imbalance for the classifier itself — it distorts
    the raw probability output, which is exactly what isotonic calibration
    fixes afterwards, not what this search optimizes for)."""
    x_train, y_train = _prepare_x(train_df), train_df[features.TARGET_COLUMN]
    x_val, y_val = _prepare_x(validation_df), validation_df[features.TARGET_COLUMN]

    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=42))
    study.optimize(
        lambda trial: _objective(trial, x_train, y_train, x_val, y_val),
        n_trials=n_trials,
        show_progress_bar=False,
    )

    best_model = lgb.LGBMClassifier(class_weight="balanced", random_state=42, verbosity=-1, **study.best_params)
    best_model.fit(x_train, y_train, categorical_feature=CATEGORICAL_COLUMNS)
    return best_model, study.best_params, study.best_value


def calibrate(model: lgb.LGBMClassifier, validation_df: pd.DataFrame) -> IsotonicRegression:
    x_val, y_val = _prepare_x(validation_df), validation_df[features.TARGET_COLUMN]
    raw_prob = model.predict_proba(x_val)[:, 1]
    calibrator = IsotonicRegression(out_of_bounds="clip")
    calibrator.fit(raw_prob, y_val)
    return calibrator


def reliability_diagram(y_true, raw_prob, calibrated_prob) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(6, 6))
    for prob, label in ((raw_prob, "before calibration"), (calibrated_prob, "after calibration")):
        frac_pos, mean_pred = calibration_curve(y_true, prob, n_bins=10, strategy="quantile")
        ax.plot(mean_pred, frac_pos, marker="o", label=label)
    ax.plot([0, 1], [0, 1], linestyle="--", color="gray", label="perfectly calibrated")
    ax.set_xlabel("Mean predicted probability")
    ax.set_ylabel("Observed frequency")
    ax.set_title("Reliability diagram — before/after isotonic calibration")
    ax.legend()
    return fig


def recall_at_k(y_true: pd.Series, scores: np.ndarray, k: int) -> float:
    if y_true.sum() == 0:
        return float("nan")
    order = np.argsort(-scores)[:k]
    return float(y_true.to_numpy()[order].sum() / y_true.sum())


def recall_at_top50_per_hour(holdout_df: pd.DataFrame, scores: np.ndarray) -> float:
    """Within each hourly bucket of holdout, what fraction of that bucket's
    actual breaches are covered by its top-50 highest-scored incidents —
    averaged over buckets that had at least one breach."""
    df = holdout_df.copy()
    df["score"] = scores
    df["bucket"] = pd.to_datetime(df["opened_at"]).dt.floor("1h")

    recalls = []
    for _, bucket_df in df.groupby("bucket"):
        actual_breaches = bucket_df[features.TARGET_COLUMN].sum()
        if actual_breaches == 0:
            continue
        top = bucket_df.nlargest(50, "score")
        recalls.append(top[features.TARGET_COLUMN].sum() / actual_breaches)

    return float(np.mean(recalls)) if recalls else float("nan")


def train_and_log(
    settings: Settings,
    incidents: pd.DataFrame,
    p4_sequences: pd.DataFrame,
    ic_windows: pd.DataFrame,
    group_load: pd.DataFrame,
    dataset_version: str | None = None,
    n_trials: int | None = None,
) -> str:
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    frame = features.build_feature_frame(
        incidents, p4_sequences, ic_windows, group_load, settings.p4_precursor_window_hours
    )
    split = temporal_split(frame, "opened_at", settings.train_end, settings.validation_end, settings.holdout_end)

    trials = n_trials if n_trials is not None else settings.optuna_trials
    model, best_params, val_auc_pr = tune_and_train(split.train, split.validation, trials)
    calibrator = calibrate(model, split.validation)

    x_holdout = _prepare_x(split.holdout)
    y_holdout = split.holdout[features.TARGET_COLUMN]
    raw_prob_holdout = model.predict_proba(x_holdout)[:, 1]
    calibrated_prob_holdout = calibrator.predict(raw_prob_holdout)

    holdout_auc_pr = average_precision_score(y_holdout, calibrated_prob_holdout)
    holdout_brier = brier_score_loss(y_holdout, calibrated_prob_holdout)
    holdout_recall_top10 = recall_at_k(y_holdout, calibrated_prob_holdout, 10)
    holdout_recall_top50h = recall_at_top50_per_hour(split.holdout, calibrated_prob_holdout)

    fig = reliability_diagram(y_holdout, raw_prob_holdout, calibrated_prob_holdout)

    bundled_model = BreachRiskModel(model, calibrator, features.FEATURE_COLUMNS, CATEGORICAL_COLUMNS)
    # Validate the bundled predict path — including SHAP — on a small real
    # batch before it's ever registered.
    bundled_model.predict(None, split.holdout.head(min(5, len(split.holdout))))

    with mlflow.start_run() as run:
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("train_end", settings.train_end)
        mlflow.log_param("validation_end", settings.validation_end)
        mlflow.log_param("holdout_end", settings.holdout_end)
        mlflow.log_param("optuna_trials", trials)
        mlflow.log_params({f"best_{k}": v for k, v in best_params.items()})

        mlflow.log_metric("val_auc_pr", val_auc_pr)
        mlflow.log_metric("holdout_auc_pr", holdout_auc_pr)
        mlflow.log_metric("holdout_brier_score", holdout_brier)
        mlflow.log_metric("holdout_recall_at_top10", holdout_recall_top10)
        mlflow.log_metric("holdout_recall_at_top50_per_hour", holdout_recall_top50h)
        mlflow.log_figure(fig, "reliability_diagram.png")
        plt.close(fig)

        mlflow.pyfunc.log_model(
            name="model",
            python_model=bundled_model,
            # BreachRiskModel.predict() calls back into src.features — both need
            # to travel with the artifact, or unpickling it from another process
            # fails to resolve `src.model.BreachRiskModel`. Resolved from this
            # file's own location, not cwd, which differs between the Docker
            # image (/app) and a local `pytest` run (repo root).
            code_paths=[str(Path(__file__).resolve().parent)],
            registered_model_name=settings.mlflow_registered_model_name if settings.auto_promote else None,
        )
        run_id = run.info.run_id

    if settings.auto_promote:
        promote_latest(settings, run_id)

    return run_id


def promote_latest(settings: Settings, run_id: str) -> None:
    client = mlflow.MlflowClient(tracking_uri=settings.mlflow_tracking_uri)
    versions = client.search_model_versions(f"name='{settings.mlflow_registered_model_name}'")
    matching = [v for v in versions if v.run_id == run_id]
    if not matching:
        LOGGER.warning("No registered model version found for run %s — skipping promotion.", run_id)
        return
    version = matching[0].version
    client.transition_model_version_stage(
        name=settings.mlflow_registered_model_name,
        version=version,
        stage="Production",
        archive_existing_versions=True,
    )
    LOGGER.info("Promoted %s v%s (run %s) to Production.", settings.mlflow_registered_model_name, version, run_id)
