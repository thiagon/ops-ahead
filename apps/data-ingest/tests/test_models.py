from uuid import uuid4

import pytest
from pydantic import ValidationError

from models import BronzeAlertEvent, BronzeMonitorEvent, EventEnvelope

_ENVELOPE = {
    "event_id": str(uuid4()),
    "tenant_id": "locaweb",
    "source": "itsm",
    "intake": "alert",
    "version": "v1",
    "received_at": "2024-01-15T10:00:00+00:00",
    "payload": '{"ticket_number": "INC0001"}',
}

_ALERT = {
    "event_id": str(uuid4()),
    "tenant_id": "locaweb",
    "source": "itsm",
    "version": "v1",
    "dictionary_version": "v1",
    "received_at": "2024-01-15T10:00:00+00:00",
    "external_id": "INC0001",
    "opened_at": "2024-01-15T09:55:00+00:00",
    "severity": 3,
    "status": "closed",
    "title": "disk full",
}

_MONITOR = {
    "event_id": str(uuid4()),
    "tenant_id": "locaweb",
    "source": "alertmanager",
    "version": "v1",
    "dictionary_version": "v1",
    "received_at": "2024-01-15T10:00:00+00:00",
    "external_id": "alert-123",
    "started_at": "2024-01-15T09:55:00+00:00",
    "condition": "firing",
    "entity_id": "srv-web-01",
}


class TestEventEnvelope:
    def test_valid_roundtrip(self):
        m = EventEnvelope.model_validate(_ENVELOPE)
        restored = EventEnvelope.model_validate_json(m.model_dump_json())
        assert restored.event_id == m.event_id
        assert restored.tenant_id == "locaweb"

    def test_extra_fields_forbidden(self):
        with pytest.raises(ValidationError):
            EventEnvelope.model_validate({**_ENVELOPE, "unexpected": "value"})

    def test_missing_tenant_id(self):
        incomplete = {k: v for k, v in _ENVELOPE.items() if k != "tenant_id"}
        with pytest.raises(ValidationError):
            EventEnvelope.model_validate(incomplete)


class TestBronzeAlertEvent:
    def test_valid_roundtrip(self):
        m = BronzeAlertEvent.model_validate(_ALERT)
        restored = BronzeAlertEvent.model_validate_json(m.model_dump_json())
        assert restored.severity == 3
        assert restored.acknowledged_at is None

    def test_severity_bounds(self):
        for ok in (1, 2, 3, 4, 5):
            BronzeAlertEvent.model_validate({**_ALERT, "severity": ok})
        for bad in (0, 6, -1):
            with pytest.raises(ValidationError):
                BronzeAlertEvent.model_validate({**_ALERT, "severity": bad})

    def test_optional_fields_default_to_none(self):
        m = BronzeAlertEvent.model_validate(_ALERT)
        assert m.entity_id is None
        assert m.owner is None
        assert m.resolution_code is None


class TestBronzeMonitorEvent:
    def test_valid_roundtrip(self):
        m = BronzeMonitorEvent.model_validate(_MONITOR)
        restored = BronzeMonitorEvent.model_validate_json(m.model_dump_json())
        assert restored.condition == "firing"
        assert restored.ended_at is None

    def test_condition_is_not_validated_against_an_enum_at_this_layer(self):
        # The dictionary is what constrains condition to firing/cleared before
        # this model ever sees it — the model itself stays a plain string so a
        # translation bug surfaces as an unexpected value, not a crash here.
        m = BronzeMonitorEvent.model_validate({**_MONITOR, "condition": "unexpected"})
        assert m.condition == "unexpected"
