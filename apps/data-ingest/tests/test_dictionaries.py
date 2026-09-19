import pytest

from config_stream import apply_dictionary
from dictionaries import Dictionary, DictionaryRegistry


def _record(version: str, mappings: dict) -> bytes:
    import json

    return json.dumps(
        {
            "tenant_id": "locaweb",
            "source": "itsm",
            "intake": "alert",
            "dictionary_version": version,
            "mappings": mappings,
        }
    ).encode()


@pytest.fixture
def registry() -> DictionaryRegistry:
    registry = DictionaryRegistry()
    apply_dictionary(registry, "locaweb:itsm", _record("v1", {"status": {"Encerrado": "closed"}}))
    apply_dictionary(
        registry,
        "locaweb:itsm",
        _record("v2", {"status": {"Encerrado": "closed", "Aguardando Problema": "waiting"}}),
    )
    return registry


def test_latest_is_the_last_record_the_log_carried(registry):
    assert registry.latest("locaweb", "itsm").dictionary_version == "v2"


def test_version_returns_a_specific_pinned_version(registry):
    assert registry.version("locaweb", "itsm", "v1").dictionary_version == "v1"


def test_a_pinned_version_translates_by_its_own_mappings(registry):
    pinned = registry.version("locaweb", "itsm", "v1")

    assert pinned.translate("status", "Encerrado") == "closed"
    # v2 added this one; v1 must not answer for it.
    assert pinned.translate("status", "Aguardando Problema") is None


def test_an_unknown_origin_has_no_dictionary_rather_than_an_empty_one():
    assert DictionaryRegistry().latest("locaweb", "itsm") is None


def test_a_tombstone_forgets_the_origin(registry):
    apply_dictionary(registry, "locaweb:itsm", None)

    assert registry.latest("locaweb", "itsm") is None


def test_a_malformed_record_does_not_stop_the_rehydration(registry):
    apply_dictionary(registry, "locaweb:itsm", b"not json")

    # The record is skipped, and what the log already carried still stands.
    assert registry.latest("locaweb", "itsm").dictionary_version == "v2"


def test_an_unmapped_value_falls_back_instead_of_failing_the_event():
    dictionary = Dictionary(
        tenant_id="locaweb",
        source="itsm",
        intake="alert",
        dictionary_version="v1",
        mappings={"status": {"Encerrado": "closed"}},
    )

    assert dictionary.translate("status", "Nunca Visto", default="unknown") == "unknown"
    assert dictionary.translate("status", "  Encerrado  ") == "closed"
