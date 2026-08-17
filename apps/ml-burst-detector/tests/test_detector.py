from src.detector import CUSUM_H, CUSUM_K, Z_SCORE_THRESHOLD, CusumState, robust_z_score, update_cusum


def test_z_score_near_zero_for_typical_count():
    history = [8, 9, 10, 11, 10, 9, 10, 11, 9, 10]
    z, median, mad = robust_z_score(10, history)
    assert abs(z) < 1.0
    assert median == 10


def test_z_score_flags_sharp_spike():
    history = [8, 9, 10, 11, 10, 9, 10, 11, 9, 10]
    z, _, _ = robust_z_score(50, history)
    assert z > Z_SCORE_THRESHOLD


def test_z_score_threshold_is_adaptive_per_ic_not_global():
    # Team14-like IC: naturally high, noisy volume — 110 is unremarkable.
    high_volume_history = [90, 95, 100, 105, 110, 95, 100, 105, 100, 95]
    z_high, _, _ = robust_z_score(110, high_volume_history)

    # A quiet IC: 1-2 incidents per bucket is normal — 110 would be catastrophic.
    quiet_history = [1, 2, 1, 2, 1, 1, 2, 1, 2, 1]
    z_quiet, _, _ = robust_z_score(110, quiet_history)

    assert abs(z_high) < Z_SCORE_THRESHOLD
    assert z_quiet > Z_SCORE_THRESHOLD


def test_z_score_flat_history_with_no_change_is_zero():
    history = [5.0] * 10
    z, median, mad = robust_z_score(5, history)
    assert z == 0.0
    assert mad == 0.0


def test_z_score_flat_history_with_small_change_stays_under_threshold():
    # A flat baseline (MAD=0) is common for low-volume ICs (most buckets sit
    # at 0-1 events) — MIN_ROBUST_STD keeps a one-off small bump from reading
    # as infinite sigma, which in the real backtest was the dominant source
    # of false alerts (see MIN_ROBUST_STD's docstring in src/detector.py).
    history = [5.0] * 10
    z, _, _ = robust_z_score(6, history)
    assert z < Z_SCORE_THRESHOLD


def test_z_score_flat_history_with_large_change_exceeds_threshold():
    history = [5.0] * 10
    z, _, _ = robust_z_score(20, history)
    assert z > Z_SCORE_THRESHOLD

    z_down, _, _ = robust_z_score(-10, history)
    assert z_down < -Z_SCORE_THRESHOLD


def test_z_score_insufficient_history_returns_zero():
    z, _, _ = robust_z_score(100, [])
    assert z == 0.0
    z, _, _ = robust_z_score(100, [5.0])
    assert z == 0.0


def test_cusum_does_not_trigger_on_stable_series():
    baseline, robust_std = 10.0, 1.4826
    state = CusumState()
    for count in [9, 10, 11, 10, 9, 10, 11, 9, 10, 10, 9, 11]:
        state, triggered = update_cusum(state, count, baseline, robust_std, k=CUSUM_K, h=CUSUM_H)
        assert not triggered


def test_cusum_triggers_on_gradual_drift_before_z_score_alone_would():
    """A slow ramp where CUSUM accumulates evidence of a sustained shift and
    fires *before* any single point's z-score crosses the alert threshold on
    its own — the whole point of tracking CUSUM alongside z-score."""
    history = [7, 10, 13, 9, 11, 8, 12, 10, 9, 11]  # median=10, robust_std≈1.4826
    baseline, robust_std = 10.0, 1.4826
    ramp = [11, 12, 13, 14, 15, 16]

    state = CusumState()
    cusum_triggered_at = None
    for i, count in enumerate(ramp):
        z, _, _ = robust_z_score(count, history)
        state, triggered = update_cusum(state, count, baseline, robust_std, k=CUSUM_K, h=CUSUM_H)
        if triggered and cusum_triggered_at is None:
            cusum_triggered_at = i
            assert z < Z_SCORE_THRESHOLD, "CUSUM should fire before the z-score alone crosses the threshold"

    assert cusum_triggered_at is not None


def test_cusum_resets_state_after_triggering():
    baseline, robust_std = 10.0, 1.4826
    state = CusumState()
    for count in [20, 21, 22, 23, 24, 25]:
        state, triggered = update_cusum(state, count, baseline, robust_std, k=CUSUM_K, h=CUSUM_H)
        if triggered:
            assert state.s_pos == 0.0
            assert state.s_neg == 0.0
            return
    assert False, "expected CUSUM to trigger on a sustained large upward shift"


def test_cusum_detects_downward_regime_change_too():
    baseline, robust_std = 10.0, 1.4826
    state = CusumState()
    triggered_ever = False
    for count in [8, 6, 5, 4, 3, 2, 1, 1, 1]:
        state, triggered = update_cusum(state, count, baseline, robust_std, k=CUSUM_K, h=CUSUM_H)
        triggered_ever = triggered_ever or triggered
    assert triggered_ever
