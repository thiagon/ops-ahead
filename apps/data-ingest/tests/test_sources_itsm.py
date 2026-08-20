from uuid import uuid4

from dictionaries import Dictionary
from models import IncidentEnvelope
from sources.itsm import translate_alert

DICTIONARY = Dictionary(
    tenant_id="locaweb",
    source="itsm",
    intake="alert",
    dictionary_version="v1",
    mappings={
        "status": {
            "Encerrado": "closed",
            "Sem Intervenção": "closed",
            "Aguardando Problema": "waiting",
        },
        "reported_by": {"Monitoramento": "automatic", "Manual": "manual"},
        "resolution_code": {"Sem Intervenção": "no_intervention"},
    },
)

# One row of assets/incidents.csv, as scripts/incident_producer.py posts it.
BODY = {
    "ticket_number": "INC0012345",
    "opened_at": "2025-12-31 23:45:18",
    "priority_code": 2,
    "configuration_item": "srv-web-04",
    "status": "Encerrado",
    "opened_by": "Monitoramento",
    "assignment_group": "NOC",
    "short_description": "disk full",
    "product": "hosting",
}


def _envelope() -> IncidentEnvelope:
    return IncidentEnvelope.model_validate(
        {
            "event_id": str(uuid4()),
            "tenant_id": "locaweb",
            "source": "itsm",
            "intake": "alert",
            "version": "v1",
            "received_at": "2026-01-01T00:00:00+00:00",
            "payload": "{}",
        }
    )


def test_maps_universal_fields():
    bronze = translate_alert(_envelope(), DICTIONARY, BODY)

    assert bronze.external_id == "INC0012345"
    assert bronze.severity == 2
    assert bronze.entity_id == "srv-web-04"
    assert bronze.owner == "NOC"
    assert bronze.title == "disk full"


def test_translates_status_and_reported_by():
    bronze = translate_alert(_envelope(), DICTIONARY, BODY)

    assert bronze.status == "closed"
    assert bronze.reported_by == "automatic"


def test_carries_no_intervention_into_resolution_code_not_status():
    body = {**BODY, "status": "Sem Intervenção"}

    bronze = translate_alert(_envelope(), DICTIONARY, body)

    assert bronze.status == "closed"
    assert bronze.resolution_code == "no_intervention"


def test_unmapped_status_becomes_unknown():
    body = {**BODY, "status": "Algo Novo"}

    bronze = translate_alert(_envelope(), DICTIONARY, body)

    assert bronze.status == "unknown"


def test_unmapped_reported_by_becomes_none_not_a_string():
    body = {**BODY, "opened_by": "Algo Novo"}

    bronze = translate_alert(_envelope(), DICTIONARY, body)

    assert bronze.reported_by is None


def test_carries_a_field_the_origin_added_without_the_adapter_knowing_it():
    body = {**BODY, "extra_future_field": "chat"}

    bronze = translate_alert(_envelope(), DICTIONARY, body)

    assert bronze.external_id == "INC0012345"


def test_stamps_the_dictionary_version_that_produced_the_row():
    bronze = translate_alert(_envelope(), DICTIONARY, BODY)

    assert bronze.dictionary_version == "v1"
