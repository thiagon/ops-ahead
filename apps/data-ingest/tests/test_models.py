import json
from uuid import uuid4

import pytest
from pydantic import ValidationError

from src.models import IncidentRaw

_VALID = {
    "event_id": str(uuid4()),
    "source": "itsm",
    "received_at": "2024-01-15T10:00:00+00:00",
    "opened_at": "2024-01-15T09:55:00+00:00",
    "severity": 3,
    "entity_id": "srv-web-01",
    "status": "open",
    "payload_raw": json.dumps({"numero": "INC0001"}),
}


def test_valid_roundtrip():
    m = IncidentRaw.model_validate(_VALID)
    restored = IncidentRaw.model_validate_json(m.model_dump_json())
    assert restored.event_id == m.event_id
    assert restored.severity == m.severity


def test_severity_bounds():
    for ok in (1, 2, 3, 4, 5):
        IncidentRaw.model_validate({**_VALID, "severity": ok})

    for bad in (0, 6, -1, 99):
        with pytest.raises(ValidationError):
            IncidentRaw.model_validate({**_VALID, "severity": bad})


def test_invalid_event_id():
    with pytest.raises(ValidationError):
        IncidentRaw.model_validate({**_VALID, "event_id": "not-a-uuid"})


def test_extra_fields_forbidden():
    with pytest.raises(ValidationError):
        IncidentRaw.model_validate({**_VALID, "unexpected": "value"})


def test_missing_required_field():
    incomplete = {k: v for k, v in _VALID.items() if k != "entity_id"}
    with pytest.raises(ValidationError):
        IncidentRaw.model_validate(incomplete)
