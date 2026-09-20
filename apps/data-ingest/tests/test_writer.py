from datetime import datetime
from uuid import uuid4

from models import EventEnvelope, MilestoneEvent
from writer import _lake_prefix, _milestone_row


def _make(source: str, intake: str, received_at: str, tenant_id: str = "locaweb") -> EventEnvelope:
    return EventEnvelope.model_validate(
        {
            "event_id": str(uuid4()),
            "tenant_id": tenant_id,
            "source": source,
            "intake": intake,
            "version": "v1",
            "received_at": received_at,
            "payload": "{}",
        }
    )


def test_lake_prefix_partitioning():
    evt = _make("itsm", "alert", "2024-03-07T14:30:00+00:00")
    assert _lake_prefix(evt) == "raw/tenant=locaweb/intake=alert/source=itsm/date=2024-03-07/"


def test_lake_prefix_different_tenants():
    a = _make("itsm", "alert", "2024-03-07T00:00:00+00:00", tenant_id="locaweb")
    b = _make("itsm", "alert", "2024-03-07T00:00:00+00:00", tenant_id="other-tenant")
    assert _lake_prefix(a) != _lake_prefix(b)
    assert "tenant=other-tenant" in _lake_prefix(b)


def test_lake_prefix_different_intakes():
    alert = _make("alertmanager", "alert", "2024-03-07T00:00:00+00:00")
    monitor = _make("alertmanager", "monitor", "2024-03-07T00:00:00+00:00")
    assert _lake_prefix(alert) != _lake_prefix(monitor)


def test_lake_prefix_utc_normalization():
    # same instant in different timezones → same date partition
    evt_utc = _make("itsm", "alert", "2024-03-07T01:00:00+00:00")
    evt_brt = _make("itsm", "alert", "2024-03-06T22:00:00-03:00")  # same UTC instant
    assert _lake_prefix(evt_utc) == _lake_prefix(evt_brt)


def _make_milestone(**overrides) -> MilestoneEvent:
    fields = {
        "event_id": str(uuid4()),
        "tenant_id": "locaweb",
        "source": "itsm",
        "external_id": "INC001",
        "entity_id": None,
        "kind": "pct_75",
        "severity": 2,
        "opened_at": "2024-03-07T01:00:00+00:00",
        "acknowledged_at": None,
        "due_at": "2024-03-07T05:00:00+00:00",
        "deadline_seconds": 14400,
        "consumed_ratio": 0.75,
        "occurred_at": "2024-03-07T04:00:00+00:00",
        **overrides,
    }
    return MilestoneEvent.model_validate(fields)


def test_milestone_row_defaults_missing_entity_id_to_empty_string():
    row = _milestone_row(_make_milestone(entity_id=None))
    assert row[4] == ""


def test_milestone_row_converts_aware_datetimes_to_naive_utc():
    row = _milestone_row(_make_milestone(occurred_at="2024-03-06T22:00:00-03:00"))
    assert row[-1] == datetime(2024, 3, 7, 1, 0, 0)


def test_publisher_protocol_carries_bytes():
    """A str payload survives the broker as a str, and a consumer whose
    handler is typed with the event model then receives the raw JSON text
    instead of a mapping — see apps/data-deadline-tracker's own contract
    test."""
    import inspect

    from writer import Publisher

    assert inspect.signature(Publisher.publish).parameters["message"].annotation is bytes
