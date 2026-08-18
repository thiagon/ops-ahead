import pytest
from pydantic import ValidationError

from src.schemas import BreachFeatureInput, VolumeFeatureInput, VolumePredictRequest


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
            assignment_group="Team14",
            opened_hour=10,
            opened_dayofweek=2,
            is_manual_open=0,
            p4_precursor_present=0,
            p4_precursor_length=0,
            sem_intervencao_count_1h=0,
            sem_intervencao_count_6h=0,
            group_load_1h=0,
            was_recategorized=0,
            recategorization_count=0,
        )


def test_breach_feature_input_allows_missing_historical_ratio():
    # NaN for a group+severity combo with no prior history is legitimate
    # (see ml-breach-model's add_historical_group_severity_features).
    feature = BreachFeatureInput(
        severity=2,
        assignment_group="Team14",
        opened_hour=10,
        opened_dayofweek=2,
        is_manual_open=1,
        p4_precursor_present=1,
        p4_precursor_length=3,
        sem_intervencao_count_1h=1,
        sem_intervencao_count_6h=4,
        group_load_1h=2,
        was_recategorized=1,
        recategorization_count=2,
    )
    assert feature.group_severity_historical_ola_ratio is None
