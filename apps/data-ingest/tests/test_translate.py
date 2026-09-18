import json
from uuid import uuid4

import pytest

from bindings import BindingRegistry, parse_bindings
from dictionaries import Dictionary, DictionaryRegistry
from models import BronzeAlertEvent, EventEnvelope
from translate import UnknownSourceError, translate


@pytest.fixture
def dictionaries():
    registry = DictionaryRegistry()
    registry.record(
        Dictionary(
            tenant_id="locaweb",
            source="itsm",
            intake="alert",
            dictionary_version="v1",
            mappings={"status": {"Encerrado": "closed"}},
        )
    )
    return registry


@pytest.fixture
def bindings():
    registry = BindingRegistry()
    registry.record(
        parse_bindings(
            {
                "tenant_id": "locaweb",
                "source": "itsm",
                "intake": "alert",
                "bindings": [
                    {"field": "external_id", "path": "ticket_number"},
                    {"field": "opened_at", "path": "opened_at"},
                    {"field": "severity", "path": "priority_code"},
                    {"field": "status", "path": "status"},
                    {"field": "title", "path": "short_description"},
                ],
            }
        )
    )
    return registry


def _envelope(**overrides) -> EventEnvelope:
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
    return EventEnvelope.model_validate(fields)


def test_translates_a_configured_origin_into_a_bronze_alert_event(dictionaries, bindings):
    bronze = translate(_envelope(), dictionaries, bindings)

    assert isinstance(bronze, BronzeAlertEvent)
    assert bronze.status == "closed"


def test_refuses_a_source_with_no_field_bindings(dictionaries, bindings):
    # An origin nobody configured is refused, never translated on a guess.
    with pytest.raises(UnknownSourceError):
        translate(_envelope(source="datadog"), dictionaries, bindings)


def test_refuses_a_tenant_with_no_dictionary(dictionaries, bindings):
    with pytest.raises(UnknownSourceError):
        translate(_envelope(tenant_id="someone-else"), dictionaries, bindings)


def test_pinning_a_dictionary_version_is_deterministic(dictionaries, bindings):
    # Reprocessing a period with a pinned dictionary_version must reproduce
    # the same bronze row every time — domain/acl/itsm.md#reprocessamento.
    pinned = dictionaries.version("locaweb", "itsm", "v1")
    envelope = _envelope()

    first = translate(envelope, dictionaries, bindings, dictionary=pinned)
    second = translate(envelope, dictionaries, bindings, dictionary=pinned)

    assert first.model_dump() == second.model_dump()
    assert first.dictionary_version == "v1"
