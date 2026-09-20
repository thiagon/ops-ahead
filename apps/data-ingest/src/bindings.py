from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: Fields the pipeline stamps itself, never read from the origin's payload
#: (contracts/field-binding.schema.json).
_STAMPED = frozenset(
    {"event_id", "tenant_id", "source", "version", "dictionary_version", "received_at"}
)

#: Fields whose values also go through the dictionary, per intake. Mirrors
#: contracts/translation-dictionary.schema.json.
TRANSLATED: dict[str, frozenset[str]] = {
    "alert": frozenset({"status", "severity", "reported_by", "resolution_code"}),
    "monitor": frozenset({"condition", "severity"}),
}


@dataclass(frozen=True)
class FieldBindings:
    """Where each field of the translated contract is read in one origin's own
    payload. What the dictionary does for values, this does for fields — it is
    what lets an origin be added as configuration rather than as code
    (domain/acl/itsm.md#adicionar-uma-origem)."""

    tenant_id: str
    source: str
    intake: str
    paths: dict[str, str]

    def value(self, body: dict[str, Any], field: str) -> Any:
        """The raw value at this field's path. An unbound field, or a path that
        does not resolve, reads as None — the contract decides whether that is
        allowed, not this lookup."""
        path = self.paths.get(field)
        if not path:
            return None

        current: Any = body
        for segment in path.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(segment)
            if current is None:
                return None
        return current


def parse_bindings(record: dict[str, Any]) -> FieldBindings:
    """One rules.mapping record as the registry publishes it."""
    paths = {
        entry["field"]: entry["path"]
        for entry in record.get("bindings", [])
        if entry.get("path") and entry["field"] not in _STAMPED
    }
    return FieldBindings(
        tenant_id=record["tenant_id"],
        source=record["source"],
        intake=record["intake"],
        paths=paths,
    )


class BindingRegistry:
    """Every origin's bindings, keyed by (tenant_id, source). Rehydrated from
    the compacted rules.mapping topic — a source absent here has no
    configuration, and its events are refused rather than guessed at."""

    def __init__(self) -> None:
        self._by_origin: dict[tuple[str, str], FieldBindings] = {}

    def record(self, bindings: FieldBindings) -> None:
        self._by_origin[(bindings.tenant_id, bindings.source)] = bindings

    def forget(self, tenant_id: str, source: str) -> None:
        self._by_origin.pop((tenant_id, source), None)

    def get(self, tenant_id: str, source: str) -> FieldBindings | None:
        return self._by_origin.get((tenant_id, source))

    def __len__(self) -> int:
        return len(self._by_origin)
