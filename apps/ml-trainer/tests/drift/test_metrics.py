from __future__ import annotations

import metrics


def _samples(gauge) -> dict[tuple[str, str, str], float]:
    return {
        (sample.labels["tenant"], sample.labels["domain"], sample.labels["feature"]): sample.value
        for metric in gauge.collect()
        for sample in metric.samples
    }


def test_two_tenants_keep_separate_drift_series():
    """The tenant is part of the series identity: drift is measured against
    one tenant's own Production model, so a shared series would report
    whichever run happened to finish last."""
    metrics.feature_drift_psi.labels(tenant="locaweb", domain="volume", feature="opened").set(0.1)
    metrics.feature_drift_psi.labels(tenant="acme", domain="volume", feature="opened").set(0.9)

    samples = _samples(metrics.feature_drift_psi)

    assert samples[("locaweb", "volume", "opened")] == 0.1
    assert samples[("acme", "volume", "opened")] == 0.9


def test_the_ks_gauge_is_labelled_the_same_way():
    metrics.feature_drift_ks_pvalue.labels(tenant="locaweb", domain="breach", feature="sev").set(
        0.04
    )

    assert _samples(metrics.feature_drift_ks_pvalue)[("locaweb", "breach", "sev")] == 0.04
