from uuid import uuid4

from models import IncidentEnvelope
from writer import _lake_prefix


def _make(source: str, intake: str, received_at: str, tenant_id: str = "locaweb") -> IncidentEnvelope:
    return IncidentEnvelope.model_validate(
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
