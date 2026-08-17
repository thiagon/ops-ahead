from __future__ import annotations

import logging

import mlflow
import numpy as np
import pandas as pd

from src.kpi_projection import monte_carlo
from src.kpi_projection.forecast import recursive_lgb_forecast
from src.settings import Settings
from src.volume import features as volume_features
from src.volume.train import train_lightgbm

LOGGER = logging.getLogger(__name__)

# The 4 independent PPR projections this analysis produces — each priority
# maps to its severity code in kpi_monthly_state.
DIMENSIONS = {"p2": 2, "p3": 3}


def _next_month_start(month_start: pd.Timestamp) -> pd.Timestamp:
    if month_start.month == 12:
        return month_start.replace(year=month_start.year + 1, month=1)
    return month_start.replace(month=month_start.month + 1)


def _month_to_date_state(kpi_state: pd.DataFrame, month_start: pd.Timestamp, severity: int) -> tuple[int, int, int]:
    """Aggregates across `source` for one severity's current-month row.
    Zeros if the month hasn't accumulated a row in the mart yet."""
    months = pd.to_datetime(kpi_state["month"])
    rows = kpi_state.loc[(months == month_start) & (kpi_state["severity"] == severity)]
    if rows.empty:
        return 0, 0, 0
    return int(rows["total"].sum()), int(rows["in_kpi"].sum()), int(rows["breached"].sum())


def _fit_lgb_and_residual_std(
    daily: pd.DataFrame, group: str, holdout_days: int
) -> tuple[object, float]:
    """Fits a fresh D+1 LightGBM on all history for `group` except the
    trailing `holdout_days`, then measures residual std on that holdout —
    the LightGBM's own empirical predictive spread, used as the Monte Carlo
    noise scale. Decoupled from the volume trainer's train/validation/holdout
    split boundaries: this analysis always forecasts from "now" forward, not
    a fixed historical backtest window."""
    frame = volume_features.build_feature_frame(daily, horizon=1)
    group_frame = frame.loc[frame["priority_group"] == group].sort_values("date").reset_index(drop=True)
    if len(group_frame) <= holdout_days:
        raise ValueError(
            f"Not enough history for group={group!r} to hold out {holdout_days} days "
            f"(have {len(group_frame)} feature rows)."
        )

    train_frame = group_frame.iloc[:-holdout_days]
    holdout_frame = group_frame.iloc[-holdout_days:]

    model = train_lightgbm(train_frame, "target_d1")

    x_holdout = holdout_frame[volume_features.FEATURE_COLUMNS].copy()
    x_holdout["priority_group"] = x_holdout["priority_group"].astype("category")
    preds = model.predict(x_holdout)
    residuals = holdout_frame["target_d1"].to_numpy() - preds
    residual_std = float(np.std(residuals, ddof=1)) if len(residuals) > 1 else float(abs(residuals[0]))
    return model, residual_std


def run_kpi_projection(settings: Settings, daily: pd.DataFrame, kpi_state: pd.DataFrame) -> dict:
    """Monte Carlo monthly KPI projection — the 4 independent PPR dimensions
    (volume P2, volume P3, OLA P2, OLA P3). Runs as an on-demand analysis
    registered in MLflow like any other experiment, not an endpoint
    (`docs/sprints/sprint-3-mvp.md` §3: "a lógica Python pode ser validada
    como script antes de virar endpoint")."""
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    long_df = volume_features.to_long_format(daily)
    as_of_date = pd.Timestamp(long_df["date"].max())
    month_start = as_of_date.replace(day=1)
    next_month_start = _next_month_start(month_start)
    remaining_days = list(pd.date_range(as_of_date + pd.Timedelta(days=1), next_month_start - pd.Timedelta(days=1), freq="D"))

    rng = np.random.default_rng(settings.kpi_projection_seed)
    n_sims = settings.kpi_projection_n_simulations

    projections: dict[str, monte_carlo.ProjectionSummary] = {}

    with mlflow.start_run() as run:
        mlflow.log_param("as_of_date", str(as_of_date.date()))
        mlflow.log_param("n_simulations", n_sims)
        mlflow.log_param("seed", settings.kpi_projection_seed)
        mlflow.log_param("days_remaining", len(remaining_days))

        for group, severity in DIMENSIONS.items():
            group_df = long_df.loc[long_df["priority_group"] == group].sort_values("date")
            model, residual_std = _fit_lgb_and_residual_std(daily, group, settings.kpi_projection_holdout_days)

            history_counts = group_df.set_index("date")["count"].tail(60)
            avg_opened_hour = float(group_df["avg_opened_hour"].tail(30).mean())

            if remaining_days:
                daily_means = recursive_lgb_forecast(model, history_counts, group, avg_opened_hour, remaining_days)
            else:
                daily_means = []

            volume_paths = monte_carlo.sample_volume_paths(daily_means, residual_std, n_sims, rng)

            total_so_far, in_kpi_so_far, breached_so_far = _month_to_date_state(kpi_state, month_start, severity)
            eligibility_rate = (in_kpi_so_far / total_so_far) if total_so_far else 1.0
            breach_rate_samples = monte_carlo.sample_breach_rate_posterior(
                breached_so_far, in_kpi_so_far, n_sims, rng
            )
            breach_paths = monte_carlo.simulate_breach_counts(volume_paths, eligibility_rate, breach_rate_samples, rng)

            volume_target = getattr(settings, f"kpi_target_volume_{group}")
            breach_target = getattr(settings, f"kpi_target_breaches_{group}")

            volume_summary = monte_carlo.aggregate_projection(total_so_far, volume_paths, volume_target)
            breach_summary = monte_carlo.aggregate_projection(breached_so_far, breach_paths, breach_target)

            projections[f"volume_{group}"] = volume_summary
            projections[f"ola_{group}"] = breach_summary

            mlflow.log_param(f"{group}_eligibility_rate", eligibility_rate)
            mlflow.log_param(f"{group}_residual_std", residual_std)
            for name, summary in ((f"volume_{group}", volume_summary), (f"ola_{group}", breach_summary)):
                mlflow.log_metric(f"{name}_median", summary.median)
                mlflow.log_metric(f"{name}_ci80_lower", summary.ci80_lower)
                mlflow.log_metric(f"{name}_ci80_upper", summary.ci80_upper)
                if summary.p_within_target is not None:
                    mlflow.log_metric(f"{name}_p_within_target", summary.p_within_target)

        run_id = run.info.run_id

    return {"run_id": run_id, "as_of_date": str(as_of_date.date()), "projections": projections}
