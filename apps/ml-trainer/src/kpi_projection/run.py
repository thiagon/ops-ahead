from __future__ import annotations

import logging

import mlflow
import numpy as np
import pandas as pd

from kpi_projection import monte_carlo
from kpi_projection.data import write_kpi_projection
from kpi_projection.forecast import recursive_lgb_forecast
from settings import Settings
from volume import features as volume_features
from volume.train import train_lightgbm

LOGGER = logging.getLogger(__name__)

# The 2 independent PPR bands this analysis projects against — kpi_group as
# defined by tenant_kpi_targets (P1+P2 combined, P3 alone). Each band's volume
# path is the sum of its priority_group parts' own independent D+1 forecasts —
# volume_features has no combined "p1_p2" series to forecast directly.
KPI_GROUP_VOLUME_PARTS = {"p1_p2": ("p1", "p2"), "p3": ("p3",)}


def _next_month_start(month_start: pd.Timestamp) -> pd.Timestamp:
    if month_start.month == 12:
        return month_start.replace(year=month_start.year + 1, month=1)
    return month_start.replace(month=month_start.month + 1)


def _month_to_date_state(achievement: pd.DataFrame, tenant_id: str, kpi_group: str, month_start: pd.Timestamp) -> tuple[int, int]:
    """This kpi_group's current-month row from gold_alert_kpi_achievement.
    Zeros if the month hasn't accumulated a row in the mart yet (breached_ytd
    then starts from the prior month's cumulative, i.e. 0 at year start)."""
    rows = achievement.loc[
        (achievement["tenant_id"] == tenant_id)
        & (achievement["kpi_group"] == kpi_group)
        & (pd.to_datetime(achievement["month"]) == month_start)
    ]
    if rows.empty:
        prior = achievement.loc[
            (achievement["tenant_id"] == tenant_id)
            & (achievement["kpi_group"] == kpi_group)
            & (pd.to_datetime(achievement["month"]) < month_start)
        ]
        breached_ytd_before = int(prior["breached_ytd"].iloc[-1]) if not prior.empty else 0
        return 0, breached_ytd_before
    row = rows.iloc[-1]
    return int(row["breached_in_month"]), int(row["breached_ytd"]) - int(row["breached_in_month"])


def _probability_of_meeting_target(totals: np.ndarray, targets: pd.DataFrame, tenant_id: str, kpi_group: str) -> monte_carlo.ProjectionSummary:
    """`p_within_target` is the fraction of simulations that close the year
    at or under the `max_breaches` of the `achievement_pct == 100` band
    (tenant_kpi_targets) — "at least met the target", not a looser band.
    `None` when this tenant/kpi_group has no target row."""
    group_targets = targets.loc[(targets["tenant_id"] == tenant_id) & (targets["kpi_group"] == kpi_group)]
    target_row = group_targets.loc[group_targets["achievement_pct"] == 100]
    ci80_lower, ci80_upper = np.percentile(totals, [10, 90])
    p_within_target = float(np.mean(totals <= target_row["max_breaches"].iloc[0])) if not target_row.empty else None
    return monte_carlo.ProjectionSummary(
        median=float(np.median(totals)),
        ci80_lower=float(ci80_lower),
        ci80_upper=float(ci80_upper),
        p_within_target=p_within_target,
    )


def _fit_lgb_and_residual_std(
    daily: pd.DataFrame, group: str, holdout_days: int
) -> tuple[object, float]:
    """Fits a fresh D+1 LightGBM on `group`'s history minus the trailing
    `holdout_days`, then measures residual std on that holdout as the Monte
    Carlo noise scale. Decoupled from the volume trainer's split boundaries
    — this always forecasts from "now" forward, not a fixed backtest window."""
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


def _eligibility(kpi_state: pd.DataFrame, month_start: pd.Timestamp, severities: tuple[int, ...]) -> tuple[float, int]:
    """(`in_kpi / total`, `in_kpi`) for this kpi_group's severities, from
    kpi_monthly_state — the same eligibility signal `silver_alert` computes,
    just not carried into gold_alert_kpi_achievement (which only tracks
    breach counts against the annual band). Rate 1.0 / count 0 (no exclusion
    assumed, no month-to-date eligible volume yet) when the month has no
    rows yet."""
    months = pd.to_datetime(kpi_state["month"])
    rows = kpi_state.loc[(months == month_start) & (kpi_state["severity"].isin(severities))]
    total = int(rows["total"].sum())
    in_kpi = int(rows["in_kpi"].sum())
    return ((in_kpi / total) if total else 1.0), in_kpi


def run_kpi_projection(
    settings: Settings,
    daily: pd.DataFrame,
    kpi_state: pd.DataFrame,
    achievement: pd.DataFrame,
    targets: pd.DataFrame,
    tenant_id: str = "locaweb",
) -> dict:
    """Monte Carlo monthly KPI projection — the 2 independent PPR bands
    tenant_kpi_targets defines (P1+P2 combined, P3 alone), projected against
    the annual cumulative band from gold_alert_kpi_achievement, not a monthly
    ceiling. Runs as an on-demand analysis registered in MLflow like any
    other experiment, not an endpoint (`docs/sprints/sprint-3-mvp.md` §3:
    "a lógica Python pode ser validada como script antes de virar
    endpoint")."""
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
    rows_to_write: list[dict] = []

    with mlflow.start_run() as run:
        mlflow.log_param("as_of_date", str(as_of_date.date()))
        mlflow.log_param("n_simulations", n_sims)
        mlflow.log_param("seed", settings.kpi_projection_seed)
        mlflow.log_param("days_remaining", len(remaining_days))

        for kpi_group, parts in KPI_GROUP_VOLUME_PARTS.items():
            volume_paths_by_part = []
            for part in parts:
                part_df = long_df.loc[long_df["priority_group"] == part].sort_values("date")
                model, residual_std = _fit_lgb_and_residual_std(daily, part, settings.kpi_projection_holdout_days)

                history_counts = part_df.set_index("date")["count"].tail(60)
                avg_opened_hour = float(part_df["avg_opened_hour"].tail(30).mean())

                daily_means = (
                    recursive_lgb_forecast(model, history_counts, part, avg_opened_hour, remaining_days)
                    if remaining_days
                    else []
                )
                volume_paths_by_part.append(monte_carlo.sample_volume_paths(daily_means, residual_std, n_sims, rng))

            volume_paths = sum(volume_paths_by_part)

            severities = (1, 2) if kpi_group == "p1_p2" else (3,)
            eligibility_rate, eligible_so_far = _eligibility(kpi_state, month_start, severities)
            breached_so_far, breached_ytd_before = _month_to_date_state(achievement, tenant_id, kpi_group, month_start)
            breach_rate_samples = monte_carlo.sample_breach_rate_posterior(breached_so_far, eligible_so_far, n_sims, rng)
            breach_paths = monte_carlo.simulate_breach_counts(volume_paths, eligibility_rate, breach_rate_samples, rng)

            breach_totals = breached_ytd_before + breached_so_far + breach_paths.sum(axis=1)
            summary = _probability_of_meeting_target(breach_totals, targets, tenant_id, kpi_group)
            projections[kpi_group] = summary

            rows_to_write.append(
                {
                    "tenant_id": tenant_id,
                    "as_of_date": as_of_date.date(),
                    "kpi_group": kpi_group,
                    "median_breaches_ytd": summary.median,
                    "ci80_lower": summary.ci80_lower,
                    "ci80_upper": summary.ci80_upper,
                    "p_within_target": summary.p_within_target,
                }
            )

            mlflow.log_param(f"{kpi_group}_eligibility_rate", eligibility_rate)
            mlflow.log_metric(f"{kpi_group}_median", summary.median)
            mlflow.log_metric(f"{kpi_group}_ci80_lower", summary.ci80_lower)
            mlflow.log_metric(f"{kpi_group}_ci80_upper", summary.ci80_upper)
            if summary.p_within_target is not None:
                mlflow.log_metric(f"{kpi_group}_p_within_target", summary.p_within_target)

        run_id = run.info.run_id

    write_kpi_projection(settings, rows_to_write)

    return {"run_id": run_id, "as_of_date": str(as_of_date.date()), "projections": projections}
