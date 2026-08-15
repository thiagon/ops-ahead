import pytest
from pydantic import TypeAdapter, ValidationError

from src.schemas import TriggerRequest

_adapter: TypeAdapter = TypeAdapter(TriggerRequest)


def test_volume_forecast_requires_split_dates():
    request = _adapter.validate_python(
        {
            "analysis": "volume_forecast",
            "train_end": "2025-09-30",
            "validation_end": "2025-10-31",
            "holdout_end": "2026-01-31",
        }
    )
    assert request.analysis == "volume_forecast"


def test_volume_forecast_without_dates_is_rejected():
    with pytest.raises(ValidationError):
        _adapter.validate_python({"analysis": "volume_forecast"})


def test_breach_risk_requires_split_dates():
    request = _adapter.validate_python(
        {
            "analysis": "breach_risk",
            "train_end": "2025-09-30",
            "validation_end": "2025-10-31",
            "holdout_end": "2026-01-31",
        }
    )
    assert request.analysis == "breach_risk"


def test_data_refresh_needs_no_dates():
    request = _adapter.validate_python({"analysis": "data_refresh"})
    assert request.analysis == "data_refresh"


def test_data_quality_check_needs_no_dates():
    request = _adapter.validate_python({"analysis": "data_quality_check"})
    assert request.analysis == "data_quality_check"


def test_unknown_analysis_is_rejected():
    with pytest.raises(ValidationError):
        _adapter.validate_python({"analysis": "something_else"})


def test_data_source_override_is_optional_and_business_language():
    request = _adapter.validate_python(
        {"analysis": "data_refresh", "data_source": "clickhouse://user:pw@host:9000/db"}
    )
    assert request.data_source == "clickhouse://user:pw@host:9000/db"
