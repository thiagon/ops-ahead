import json
from uuid import uuid4

import pytest

from dictionaries import DictionaryRegistry
from models import BronzeAlertEvent, IncidentEnvelope
from translate import UnknownSourceError, translate


@pytest.fixture
def dictionaries(tmp_path):
    tenant_dir = tmp_path / "locaweb"
    tenant_dir.mkdir()
    (tenant_dir / "itsm.v1.json").write_text(
        json.dumps(
            {
                "tenant_id": "locaweb",
                "source": "itsm",
                "intake": "alert",
                "dictionary_version": "v1",
                "mappings": {"status": {"Encerrado": "closed"}},
            }
        )
    )
    return DictionaryRegistry(tmp_path)


def _envelope(**overrides) -> IncidentEnvelope:
    body = {
        "ticket_number": "INC0012345",
        "opened_at": "2025-12-31 23:45:18",
        "priority_code": 2,
        "status": "Encerrado",
        "short_description": "disk full",
    }
    fields = {
        "event_id": str(uuid4()),
        "tenant_id": "locaweb",
        "source": "itsm",
        "intake": "alert",
        "version": "v1",
        "received_at": "2026-01-01T00:00:00+00:00",
        "payload": json.dumps(body),
    }
    fields.update(overrides)
    return IncidentEnvelope.model_validate(fields)


def test_translates_a_known_source_into_a_bronze_alert_event(dictionaries):
    bronze = translate(_envelope(), dictionaries)

    assert isinstance(bronze, BronzeAlertEvent)
    assert bronze.status == "closed"


def test_raises_for_a_source_with_no_adapter(dictionaries):
    with pytest.raises(UnknownSourceError):
        translate(_envelope(source="datadog"), dictionaries)


def test_raises_for_a_tenant_with_no_dictionary(dictionaries):
    with pytest.raises(UnknownSourceError):
        translate(_envelope(tenant_id="someone-else"), dictionaries)


def test_pinning_a_dictionary_version_is_deterministic(dictionaries):
    # Reprocessing a period with a pinned dictionary_version must reproduce
    # the same bronze row every time — domain/acl/itsm.md#reprocessamento.
    pinned = dictionaries.version("locaweb", "itsm", "v1")
    envelope = _envelope()

    first = translate(envelope, dictionaries, dictionary=pinned)
    second = translate(envelope, dictionaries, dictionary=pinned)

    assert first.model_dump() == second.model_dump()
    assert first.dictionary_version == "v1"
