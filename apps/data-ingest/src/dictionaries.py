from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Dictionary:
    tenant_id: str
    source: str
    intake: str
    dictionary_version: str
    mappings: dict[str, dict[str, str]]

    def translate(self, field: str, raw: str | None, default: str | None = None) -> str | None:
        """A value outside the dictionary is the unknown case — it surfaces as
        `default`, it never fails the event (domain/acl/itsm.md)."""
        table = self.mappings.get(field, {})
        return table.get((raw or "").strip(), default)


class DictionaryRegistry:
    """Every dictionary this consumer knows, keyed by (tenant_id, source).
    Rehydrated from the compacted config.dictionary topic, which carries the
    current version of each — reprocessing pins an explicit version instead
    (see reprocess.py)."""

    def __init__(self) -> None:
        self._latest: dict[tuple[str, str], Dictionary] = {}
        self._by_version: dict[tuple[str, str, str], Dictionary] = {}

    def record(self, dictionary: Dictionary) -> None:
        key = (dictionary.tenant_id, dictionary.source)
        self._by_version[(*key, dictionary.dictionary_version)] = dictionary
        self._latest[key] = dictionary

    def forget(self, tenant_id: str, source: str) -> None:
        self._latest.pop((tenant_id, source), None)

    def latest(self, tenant_id: str, source: str) -> Dictionary | None:
        return self._latest.get((tenant_id, source))

    def version(self, tenant_id: str, source: str, dictionary_version: str) -> Dictionary | None:
        return self._by_version.get((tenant_id, source, dictionary_version))

    def __len__(self) -> int:
        return len(self._latest)
