import json

import pytest

from dictionaries import DictionaryRegistry


@pytest.fixture
def dict_root(tmp_path):
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
    (tenant_dir / "itsm.v2.json").write_text(
        json.dumps(
            {
                "tenant_id": "locaweb",
                "source": "itsm",
                "intake": "alert",
                "dictionary_version": "v2",
                "mappings": {"status": {"Encerrado": "closed", "Aguardando Problema": "waiting"}},
            }
        )
    )
    return tmp_path


def test_latest_picks_the_highest_version(dict_root):
    registry = DictionaryRegistry(dict_root)

    latest = registry.latest("locaweb", "itsm")

    assert latest.dictionary_version == "v2"


def test_version_returns_a_specific_pinned_version(dict_root):
    registry = DictionaryRegistry(dict_root)

    pinned = registry.version("locaweb", "itsm", "v1")

    assert pinned.dictionary_version == "v1"
    assert pinned.translate("status", "Aguardando Problema") is None


def test_missing_tenant_or_source_returns_none(dict_root):
    registry = DictionaryRegistry(dict_root)

    assert registry.latest("other-tenant", "itsm") is None
    assert registry.latest("locaweb", "datadog") is None


def test_translate_falls_back_to_default_for_unknown_value(dict_root):
    registry = DictionaryRegistry(dict_root)
    dictionary = registry.latest("locaweb", "itsm")

    assert dictionary.translate("status", "Nunca Visto", default="unknown") == "unknown"


def test_translate_strips_whitespace(dict_root):
    registry = DictionaryRegistry(dict_root)
    dictionary = registry.latest("locaweb", "itsm")

    assert dictionary.translate("status", "  Encerrado  ") == "closed"


def test_empty_directory_yields_no_dictionaries(tmp_path):
    registry = DictionaryRegistry(tmp_path)

    assert registry.latest("locaweb", "itsm") is None
