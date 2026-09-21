from __future__ import annotations

import pandas as pd
import pytest

from recurring_causes.features import (
    BEHAVIOUR_FEATURES,
    build_entity_features,
    entities_with_history,
)


def _breakdown(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def _row(**overrides) -> dict:
    return {
        "tenant_id": "locaweb",
        "date": pd.Timestamp("2026-08-03"),  # a Monday
        "category": "rede",
        "product": "vps",
        "entity_id": "srv-01",
        "severity": 3,
        "incident_count": 4,
        "breached": 1,
        "avg_duration_seconds": 3600.0,
        **overrides,
    }


def test_category_and_product_are_never_fitted_on():
    # Grouping by them would reproduce the mart's own key; "this group is
    # mostly product X" is only a finding if X was not an input.
    assert "category" not in BEHAVIOUR_FEATURES
    assert "product" not in BEHAVIOUR_FEATURES


def test_builds_one_row_per_entity_carrying_its_behaviour():
    features = build_entity_features(
        _breakdown([_row(), _row(date=pd.Timestamp("2026-08-04"), incident_count=2)]), window_days=90
    )

    assert list(features["entity_id"]) == ["srv-01"]
    assert features["incident_count"].iat[0] == 6
    assert features["incidents_per_active_day"].iat[0] == 3.0


def test_severity_mix_is_weighted_by_volume():
    features = build_entity_features(
        _breakdown([_row(severity=1, incident_count=9), _row(severity=5, incident_count=1)]),
        window_days=90,
    )

    assert features["critical_share"].iat[0] == 0.9
    assert features["severity_mean"].iat[0] == pytest.approx(1.4)


def test_weekend_share_separates_entities_that_fail_off_hours():
    weekday = build_entity_features(_breakdown([_row(date=pd.Timestamp("2026-08-03"))]), window_days=90)
    weekend = build_entity_features(_breakdown([_row(date=pd.Timestamp("2026-08-08"))]), window_days=90)

    assert weekday["weekend_share"].iat[0] == 0.0
    assert weekend["weekend_share"].iat[0] == 1.0


def test_an_entity_below_the_minimum_is_left_out_entirely():
    # Being left out is a result, not an omission: a point described by two
    # incidents positions itself by chance.
    features = build_entity_features(
        _breakdown([_row(entity_id="busy", incident_count=20), _row(entity_id="quiet", incident_count=2)]),
        window_days=90,
    )

    kept = entities_with_history(features, min_incidents=5)

    assert list(kept["entity_id"]) == ["busy"]
