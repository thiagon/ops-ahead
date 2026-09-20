from uuid import uuid4

from bindings import FieldBindings, parse_bindings
from dictionaries import Dictionary
from models import EventEnvelope
from sources.generic import translate_alert

DICTIONARY = Dictionary(
    tenant_id="locaweb",
    source="itsm",
    intake="alert",
    version="v1",
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

# The ITSM's own field names, as the origin registry publishes them.
BINDINGS = FieldBindings(
    tenant_id="locaweb",
    source="itsm",
    intake="alert",
    paths={
        "external_id": "ticket_number",
        "opened_at": "opened_at",
        "severity": "priority_code",
        "status": "status",
        "entity_id": "configuration_item",
        "title": "short_description",
        "owner": "assignment_group",
        "reported_by": "opened_by",
        "resolution_code": "status",
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


def _envelope() -> EventEnvelope:
    return EventEnvelope.model_validate(
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
    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, BODY)

    assert bronze.external_id == "INC0012345"
    assert bronze.severity == 2
    assert bronze.entity_id == "srv-web-04"
    assert bronze.owner == "NOC"
    assert bronze.title == "disk full"


def test_translates_status_and_reported_by():
    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, BODY)

    assert bronze.status == "closed"
    assert bronze.reported_by == "automatic"


def test_carries_no_intervention_into_resolution_code_not_status():
    body = {**BODY, "status": "Sem Intervenção"}

    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, body)

    assert bronze.status == "closed"
    assert bronze.resolution_code == "no_intervention"


def test_unmapped_status_becomes_unknown():
    body = {**BODY, "status": "Algo Novo"}

    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, body)

    assert bronze.status == "unknown"


def test_unmapped_reported_by_becomes_none_not_a_string():
    body = {**BODY, "opened_by": "Algo Novo"}

    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, body)

    assert bronze.reported_by is None


def test_carries_a_field_the_origin_added_without_the_adapter_knowing_it():
    body = {**BODY, "extra_future_field": "chat"}

    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, body)

    assert bronze.external_id == "INC0012345"


def test_stamps_the_dictionary_version_that_produced_the_row():
    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, BODY)

    assert bronze.dictionary_version == "v1"


def test_reads_a_nested_path_the_way_the_binding_spells_it():
    bindings = parse_bindings(
        {
            "tenant_id": "locaweb",
            "source": "service_now",
            "intake": "alert",
            "bindings": {
                "external_id": "fields.number",
                "opened_at": "opened_at",
                "severity": "priority_code",
                "title": "short_description",
                "status": "fields.state.name",
            },
        }
    )
    body = {
        **BODY,
        "fields": {"number": "INC999", "state": {"name": "Encerrado"}},
    }

    bronze = translate_alert(_envelope(), DICTIONARY, bindings, body)

    assert bronze.external_id == "INC999"
    assert bronze.status == "closed"


def test_an_unbound_optional_field_reads_as_none_not_as_the_raw_body():
    body = {**BODY, "resolution": "trocou o disco"}

    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, body)

    # resolution_summary has no binding here, so the value is not picked up by
    # happening to share a name with a key in the payload.
    assert bronze.resolution_summary is None


def test_translates_severity_off_the_origins_own_scale():
    dictionary = Dictionary(
        tenant_id="locaweb",
        source="service_now",
        intake="alert",
        version="v1",
        mappings={**DICTIONARY.mappings, "severity": {"1 - Crítica": "1"}},
    )
    body = {**BODY, "priority_code": "1 - Crítica"}

    bronze = translate_alert(_envelope(), dictionary, BINDINGS, body)

    assert bronze.severity == 1


def test_passes_a_numeric_severity_through_when_no_mapping_exists():
    bronze = translate_alert(_envelope(), DICTIONARY, BINDINGS, BODY)

    assert bronze.severity == 2


def test_reads_labels_from_the_bound_path():
    bindings = FieldBindings(
        tenant_id=BINDINGS.tenant_id,
        source=BINDINGS.source,
        intake=BINDINGS.intake,
        paths={**BINDINGS.paths, "labels": "tags"},
    )
    body = {**BODY, "tags": {"product": "hosting", "tier": "gold"}}

    bronze = translate_alert(_envelope(), DICTIONARY, bindings, body)

    assert bronze.labels == {"product": "hosting", "tier": "gold"}


def test_joins_several_origin_fields_into_labels():
    bindings = parse_bindings(
        {
            "tenant_id": "locaweb",
            "source": "itsm",
            "intake": "alert",
            "bindings": {
                "external_id": "ticket_number",
                "opened_at": "opened_at",
                "severity": "priority_code",
                "title": "short_description",
                "status": "status",
                "labels": [
                    {"key": "product", "path": "product"},
                    {"key": "category", "path": "category"},
                    {"key": "subcategory", "path": "subcategory"},
                ],
            },
        }
    )
    body = {**BODY, "category": "rede", "subcategory": "disco"}

    bronze = translate_alert(_envelope(), DICTIONARY, bindings, body)

    assert bronze.labels == {"product": "hosting", "category": "rede", "subcategory": "disco"}
