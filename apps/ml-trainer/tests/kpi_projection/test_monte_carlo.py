import numpy as np

from kpi_projection.monte_carlo import (
    aggregate_projection,
    sample_breach_rate_posterior,
    sample_volume_paths,
    simulate_breach_counts,
)


class TestSampleBreachRatePosterior:
    def test_returns_values_within_unit_interval(self):
        rng = np.random.default_rng(1)
        samples = sample_breach_rate_posterior(breaches_so_far=5, eligible_so_far=500, n_sims=1000, rng=rng)

        assert samples.shape == (1000,)
        assert np.all((samples >= 0.0) & (samples <= 1.0))

    def test_same_seed_reproduces_same_samples(self):
        samples_a = sample_breach_rate_posterior(3, 300, 500, np.random.default_rng(42))
        samples_b = sample_breach_rate_posterior(3, 300, 500, np.random.default_rng(42))

        np.testing.assert_array_equal(samples_a, samples_b)

    def test_more_breaches_shifts_posterior_mean_higher(self):
        rng = np.random.default_rng(7)
        low = sample_breach_rate_posterior(1, 1000, 5000, rng)
        high = sample_breach_rate_posterior(50, 1000, 5000, rng)

        assert high.mean() > low.mean()

    def test_zero_eligible_falls_back_to_uniform_prior(self):
        rng = np.random.default_rng(7)
        samples = sample_breach_rate_posterior(0, 0, 5000, rng)

        assert 0.4 < samples.mean() < 0.6


class TestSampleVolumePaths:
    def test_shape_matches_sims_and_days(self):
        rng = np.random.default_rng(1)
        paths = sample_volume_paths([10.0, 12.0, 8.0], residual_std=2.0, n_sims=200, rng=rng)

        assert paths.shape == (200, 3)

    def test_non_negative(self):
        rng = np.random.default_rng(1)
        paths = sample_volume_paths([0.5, 0.2], residual_std=5.0, n_sims=500, rng=rng)

        assert np.all(paths >= 0)

    def test_same_seed_reproduces_same_paths(self):
        paths_a = sample_volume_paths([10.0, 12.0], 2.0, 300, np.random.default_rng(99))
        paths_b = sample_volume_paths([10.0, 12.0], 2.0, 300, np.random.default_rng(99))

        np.testing.assert_array_equal(paths_a, paths_b)

    def test_mean_tracks_daily_means_with_zero_noise(self):
        rng = np.random.default_rng(1)
        paths = sample_volume_paths([10.0, 20.0], residual_std=0.0, n_sims=50, rng=rng)

        assert np.all(paths[:, 0] == 10.0)
        assert np.all(paths[:, 1] == 20.0)


class TestSimulateBreachCounts:
    def test_shape_and_non_negative(self):
        rng = np.random.default_rng(1)
        volume_paths = np.full((100, 4), 20.0)
        breach_rate_samples = np.full(100, 0.1)

        breaches = simulate_breach_counts(volume_paths, eligibility_rate=0.9, breach_rate_samples=breach_rate_samples, rng=rng)

        assert breaches.shape == (100, 4)
        assert np.all(breaches >= 0)
        assert np.all(breaches <= volume_paths)

    def test_zero_breach_rate_produces_zero_breaches(self):
        rng = np.random.default_rng(1)
        volume_paths = np.full((50, 3), 15.0)
        breach_rate_samples = np.zeros(50)

        breaches = simulate_breach_counts(volume_paths, 0.8, breach_rate_samples, rng)

        assert np.all(breaches == 0)


class TestAggregateProjection:
    def test_median_and_ci80_on_known_distribution(self):
        simulated_daily = np.tile(np.arange(1, 101).reshape(-1, 1), (1, 1)).astype(float)  # 1..100, one "day"

        summary = aggregate_projection(actual_so_far=0, simulated_daily=simulated_daily, target=None)

        assert summary.median == 50.5
        assert summary.ci80_lower < summary.median < summary.ci80_upper
        assert summary.p_within_target is None

    def test_actual_so_far_shifts_totals(self):
        simulated_daily = np.zeros((10, 2))

        summary = aggregate_projection(actual_so_far=42, simulated_daily=simulated_daily, target=None)

        assert summary.median == 42
        assert summary.ci80_lower == 42
        assert summary.ci80_upper == 42

    def test_p_within_target_fraction(self):
        # 4 sims total at 10, 6 sims total at 30 -> target=20 satisfied by the 4 sims at 10
        simulated_daily = np.array([[10.0]] * 4 + [[30.0]] * 6)

        summary = aggregate_projection(actual_so_far=0, simulated_daily=simulated_daily, target=20)

        assert summary.p_within_target == 0.4
