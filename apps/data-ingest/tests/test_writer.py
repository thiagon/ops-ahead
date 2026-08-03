import json
from uuid import uuid4


from src.models import IncidentEvent
from src.writer import _minio_key


def _make(source: str, opened_at: str) -> IncidentEvent:
    return IncidentEvent.model_validate(
        {
            "event_id": str(uuid4()),
            "source": source,
            "received_at": "2024-01-15T10:00:00+00:00",
            "opened_at": opened_at,
            "severity": 2,
            "entity_id": "host-01",
            "status": "open",
            "payload_raw": json.dumps({}),
        }
    )


def test_minio_key_partitioning():
    evt = _make("itsm", "2024-03-07T14:30:00+00:00")
    assert _minio_key(evt) == "received/source=itsm/date=2024-03-07/"


def test_minio_key_different_sources():
    a = _make("itsm", "2024-03-07T00:00:00+00:00")
    b = _make("alertmanager", "2024-03-07T00:00:00+00:00")
    assert _minio_key(a) != _minio_key(b)
    assert "source=alertmanager" in _minio_key(b)


def test_minio_key_utc_normalization():
    # same instant in different timezones → same date partition
    evt_utc = _make("src", "2024-03-07T01:00:00+00:00")
    evt_brt = _make("src", "2024-03-06T22:00:00-03:00")  # same UTC instant
    assert _minio_key(evt_utc) == _minio_key(evt_brt)
