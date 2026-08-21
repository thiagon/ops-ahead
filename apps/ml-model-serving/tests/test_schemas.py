import pytest
from pydantic import ValidationError

from schemas import BreachFeatureInput, VolumeFeatureInput, VolumePredictRequest


def test_volume_feature_input_accepts_valid_payload():
    feature = VolumeFeatureInput(
        priority_group="p1",
        date="2026-01-15T00:00:00Z",
        avg_opened_hour=12.0,
        lag_1=10,
        lag_7=8,
        lag_14=9,
        roll_mean_7=9.5,
        roll_mean_30=9.0,
    )
    assert feature.priority_group == "p1"


def test_volume_feature_input_rejects_unknown_priority_group():
    with pytest.raises(ValidationError):
        VolumeFeatureInput(
            priority_group="p4",  # only total/p1/p2/p3 are modeled
            date="2026-01-15T00:00:00Z",
            avg_opened_hour=12.0,
            lag_1=10,
            lag_7=8,
            lag_14=9,
            roll_mean_7=9.5,
            roll_mean_30=9.0,
        )


def test_volume_feature_input_rejects_extra_fields():
    with pytest.raises(ValidationError):
        VolumeFeatureInput(
            priority_group="total",
            date="2026-01-15T00:00:00Z",
            avg_opened_hour=12.0,
            lag_1=10,
            lag_7=8,
            lag_14=9,
            roll_mean_7=9.5,
            roll_mean_30=9.0,
            unexpected_field=1,
        )


def test_volume_predict_request_requires_at_least_one_feature_row():
    with pytest.raises(ValidationError):
        VolumePredictRequest(features=[])


def test_breach_feature_input_rejects_severity_outside_p1_p3():
    with pytest.raises(ValidationError):
        BreachFeatureInput(
            severity=4,  # only P1-P3 are KPI-eligible
            owner="Team14",
            opened_hour=10,
            opened_dayofweek=2,
            is_manual_open=0,
            p4_precursor_present=0,
            p4_precursor_length=0,
            no_intervention_count_1h=0,
            no_intervention_count_6h=0,
            group_load=0,
            was_recategorized=0,
            recategorization_count=0,
            consumed_ratio=0.25,
            time_remaining_seconds=3600.0,
            was_acknowledged=0,
            entity_signal_count_15m=0,
            entity_signal_count_1h=0,
            entity_severity_escalations=0,
        )


def test_breach_feature_input_allows_missing_historical_ratio_and_auto_resolution_rate():
    # NaN for a group+severity combo with no prior history, or an entity with
    # no monitor-chain history yet, is legitimate (see ml-breach-model's
    # add_historical_group_severity_features / add_monitor_context_features).
    feature = BreachFeatureInput(
        severity=2,
        owner="Team14",
        opened_hour=10,
        opened_dayofweek=2,
        is_manual_open=1,
        p4_precursor_present=1,
        p4_precursor_length=3,
        no_intervention_count_1h=1,
        no_intervention_count_6h=4,
        group_load=2,
        was_recategorized=1,
        recategorization_count=2,
        consumed_ratio=0.5,
        time_remaining_seconds=1800.0,
        was_acknowledged=1,
        entity_signal_count_15m=2,
        entity_signal_count_1h=6,
        entity_severity_escalations=1,
    )
    assert feature.group_severity_historical_ola_ratio is None
    assert feature.entity_auto_resolution_rate is None
