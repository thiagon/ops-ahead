import numpy as np
import pandas as pd

from drift.monitor import PSI_SIGNIFICANT_THRESHOLD, compute_drift

RNG = np.random.default_rng(42)


def _frame(**columns: np.ndarray) -> pd.DataFrame:
    return pd.DataFrame(columns)


def test_stable_numeric_feature_has_low_psi_and_high_ks_pvalue():
    reference = _frame(stable=RNG.normal(loc=10, scale=2, size=2000))
    current = _frame(stable=RNG.normal(loc=10, scale=2, size=500))

    result = compute_drift(reference, current, ["stable"])["stable"]

    assert result.psi < 0.1
    assert result.ks_pvalue > 0.05  # can't reject "same distribution"


def test_shifted_numeric_feature_has_high_psi_and_low_ks_pvalue():
    reference = _frame(shifted=RNG.normal(loc=10, scale=2, size=2000))
    current = _frame(shifted=RNG.normal(loc=18, scale=2, size=500))  # 4 std devs away

    result = compute_drift(reference, current, ["shifted"])["shifted"]

    assert result.psi > PSI_SIGNIFICANT_THRESHOLD
    assert result.ks_pvalue < 0.01


def test_categorical_feature_skips_ks_but_computes_psi():
    reference = _frame(group=RNG.choice(["A", "B", "C"], size=1000, p=[0.6, 0.3, 0.1]))
    current = _frame(group=RNG.choice(["A", "B", "C"], size=300, p=[0.6, 0.3, 0.1]))

    result = compute_drift(reference, current, ["group"])["group"]

    assert result.psi < 0.1
    assert result.ks_pvalue is None


def test_categorical_feature_with_a_new_dominant_category_has_high_psi():
    reference = _frame(group=RNG.choice(["A", "B", "C"], size=1000, p=[0.6, 0.3, 0.1]))
    current = _frame(group=RNG.choice(["A", "B", "C"], size=300, p=[0.05, 0.05, 0.9]))

    result = compute_drift(reference, current, ["group"])["group"]

    assert result.psi > PSI_SIGNIFICANT_THRESHOLD


def test_computes_drift_for_multiple_features_independently():
    reference = _frame(
        stable=RNG.normal(loc=0, scale=1, size=1000),
        shifted=RNG.normal(loc=0, scale=1, size=1000),
    )
    current = _frame(
        stable=RNG.normal(loc=0, scale=1, size=300),
        shifted=RNG.normal(loc=5, scale=1, size=300),
    )

    results = compute_drift(reference, current, ["stable", "shifted"])

    assert set(results) == {"stable", "shifted"}
    assert results["stable"].psi < results["shifted"].psi


def test_mixed_numeric_and_categorical_columns_in_one_call():
    reference = _frame(
        numeric=RNG.normal(loc=0, scale=1, size=500),
        category=RNG.choice(["A", "B"], size=500),
    )
    current = _frame(
        numeric=RNG.normal(loc=0, scale=1, size=200),
        category=RNG.choice(["A", "B"], size=200),
    )

    results = compute_drift(reference, current, ["numeric", "category"])

    assert results["numeric"].ks_pvalue is not None
    assert results["category"].ks_pvalue is None
