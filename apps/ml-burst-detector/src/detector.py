from __future__ import annotations

import statistics
from dataclasses import dataclass

# Algorithm parameters, not environment config — no deployment would ever
# want a different window set, alert threshold, history depth, or CUSUM
# tuning than any other; these are part of the detector itself.
WINDOWS_SECONDS: dict[str, int] = {"15m": 15 * 60, "1h": 60 * 60, "6h": 6 * 60 * 60}
Z_SCORE_THRESHOLD = 3.5

# How many past completed buckets of a window to keep as its historical
# baseline (median/MAD) — 200 buckets of the 15m window is ~50h of history.
HISTORY_LENGTH = 200

# CUSUM: k is the slack (in robust-std units) allowed before drift starts
# accumulating; h is the decision threshold that triggers an alert.
CUSUM_K = 0.5
CUSUM_H = 5.0

# A floor under the robust std, in counts. Most ICs sit at 0-1 events per
# 15-minute bucket, so MAD is 0 for the large majority of buckets (backtested:
# ~68% of windows against the real dataset) — without a floor, *any* nonzero
# deviation from a flat baseline reads as infinite sigma, which in practice
# meant a quiet IC's second-ever incident in a bucket fired a "spike" alert.
# The floor makes "no variance ever observed" require an actually large jump
# (> Z_SCORE_THRESHOLD * MIN_ROBUST_STD counts above the baseline) instead of
# any jump at all — this is what took the real backtested precision from
# 0.075 to a usable range (see apps/ml-burst-detector/scripts/backtest.py).
MIN_ROBUST_STD = 1.0


def median_absolute_deviation(history: list[float], median: float) -> float:
    if not history:
        return 0.0
    deviations = [abs(x - median) for x in history]
    return statistics.median(deviations)


def robust_std_from_mad(mad: float) -> float:
    # 1.4826 is the constant that makes MAD a consistent estimator of the
    # standard deviation under a normal distribution.
    return max(1.4826 * mad, MIN_ROBUST_STD)


def robust_z_score(current_count: float, history: list[float]) -> tuple[float, float, float]:
    """Robust z-score of `current_count` against `history` (past completed
    buckets of the same window, for the same IC) using median + MAD instead of
    mean + stddev — a handful of outlier days (or a single ongoing incident)
    can't drag a robust baseline the way they drag a mean/stddev one, which is
    exactly what makes a *global* threshold wrong here: Team14's naturally
    high volume and a quiet IC both need their own baseline.

    Returns (z_score, median, mad). With fewer than 2 history points, returns
    z=0 — there isn't enough of a baseline yet to call anything anomalous.
    """
    if len(history) < 2:
        return 0.0, (history[0] if history else 0.0), 0.0

    median = statistics.median(history)
    mad = median_absolute_deviation(history, median)
    robust_std = robust_std_from_mad(mad)
    z = (current_count - median) / robust_std
    return z, median, mad


@dataclass
class CusumState:
    s_pos: float = 0.0
    s_neg: float = 0.0


def update_cusum(
    state: CusumState, current_count: float, baseline: float, robust_std: float, k: float, h: float
) -> tuple[CusumState, bool]:
    """Bidirectional (two-sided) CUSUM for a *gradual* regime change, as
    opposed to `robust_z_score`'s single-point spike detection. `k` (in
    robust-std units) is the slack allowed before drift starts accumulating —
    small, persistent deviations that never individually cross the z-score
    threshold still trip this after enough of them accumulate. Returns the
    updated state and whether this observation triggered an alert.
    """
    if robust_std == 0:
        return state, False

    k_abs = k * robust_std
    s_pos = max(0.0, state.s_pos + (current_count - baseline - k_abs))
    s_neg = min(0.0, state.s_neg + (current_count - baseline + k_abs))

    triggered = s_pos > h or s_neg < -h
    new_state = CusumState(s_pos=0.0, s_neg=0.0) if triggered else CusumState(s_pos=s_pos, s_neg=s_neg)
    return new_state, triggered
