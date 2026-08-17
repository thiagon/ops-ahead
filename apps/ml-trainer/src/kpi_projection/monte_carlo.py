from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ProjectionSummary:
    median: float
    ci80_lower: float
    ci80_upper: float
    p_within_target: float | None


def sample_breach_rate_posterior(
    breaches_so_far: int, eligible_so_far: int, n_sims: int, rng: np.random.Generator
) -> np.ndarray:
    """One draw per simulation of the month's "true" breach rate, from a
    Beta(1,1) uniform prior updated with month-to-date eligible/breached
    counts. Held constant across a simulation's remaining days — this models
    uncertainty about the rate itself, not day-to-day rate fluctuation, which
    is the standard Beta-Binomial formulation for this kind of aggregate
    projection."""
    alpha = 1 + breaches_so_far
    beta = 1 + max(eligible_so_far - breaches_so_far, 0)
    return rng.beta(alpha, beta, size=n_sims)


def sample_volume_paths(
    daily_means: Sequence[float], residual_std: float, n_sims: int, rng: np.random.Generator
) -> np.ndarray:
    """(n_sims, len(daily_means)) array of simulated daily incident counts —
    each day's mean comes from the LightGBM recursive point forecast
    (`forecast.recursive_lgb_forecast`), with independent Normal(mean,
    residual_std) noise per day and simulation, clipped at 0 and rounded to
    whole incidents. `residual_std` is the empirical std of D+1 residuals on
    a held-out tail of real history — the LightGBM model's own predictive
    spread, not a modeling assumption."""
    n_days = len(daily_means)
    means = np.asarray(daily_means, dtype=float)
    noise = rng.normal(loc=0.0, scale=max(residual_std, 0.0), size=(n_sims, n_days))
    samples = means[np.newaxis, :] + noise
    return np.clip(np.round(samples), a_min=0, a_max=None)


def simulate_breach_counts(
    volume_paths: np.ndarray,
    eligibility_rate: float,
    breach_rate_samples: np.ndarray,
    rng: np.random.Generator,
) -> np.ndarray:
    """(n_sims, n_days) simulated breach counts: each day's simulated volume
    is scaled by the month-to-date KPI-eligibility rate (P1–P3 incidents
    minus parent/"Sem Intervenção" exclusions), then a Binomial draw applies
    that simulation's own sampled breach rate."""
    eligible_volume = np.clip(np.round(volume_paths * eligibility_rate), a_min=0, a_max=None).astype(int)
    p = np.clip(breach_rate_samples[:, np.newaxis], 0.0, 1.0)
    return rng.binomial(n=eligible_volume, p=np.broadcast_to(p, eligible_volume.shape))


def aggregate_projection(
    actual_so_far: float, simulated_daily: np.ndarray, target: float | None
) -> ProjectionSummary:
    """End-of-month total per simulation = month-to-date actual + sum of
    that simulation's remaining-days draws. `target` is a Locaweb PPR target
    (max allowed volume/breaches) — `p_within_target` is the fraction of
    simulations that close at or under it; `None` when no target is
    configured for this dimension."""
    totals = actual_so_far + simulated_daily.sum(axis=1)
    ci80_lower, ci80_upper = np.percentile(totals, [10, 90])
    p_within_target = float(np.mean(totals <= target)) if target is not None else None
    return ProjectionSummary(
        median=float(np.median(totals)),
        ci80_lower=float(ci80_lower),
        ci80_upper=float(ci80_upper),
        p_within_target=p_within_target,
    )
