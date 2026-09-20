from __future__ import annotations

from dataclasses import dataclass, field
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


def at(body: dict[str, Any], path: str) -> Any:
    """The raw value at a dotted path. A segment that does not resolve reads
    as None — the contract decides whether that is allowed, not this lookup."""
    current: Any = body
    for segment in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(segment)
        if current is None:
            return None
    return current


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
    #: Bronze labels map: destination key → origin path. Empty when labels is
    #: a single path to a map the origin already sends (that path lives in
    #: `paths["labels"]`).
    label_paths: dict[str, str] = field(default_factory=dict)

    def value(self, body: dict[str, Any], field: str) -> Any:
        path = self.paths.get(field)
        if not path:
            return None
        return at(body, path)


def _label_paths(raw: Any) -> dict[str, str]:
    """Several origin fields joined into the bronze labels map."""
    if not isinstance(raw, list):
        return {}
    return {
        str(entry["key"]): str(entry["path"])
        for entry in raw
        if isinstance(entry, dict) and entry.get("key") and entry.get("path")
    }


def parse_bindings(record: dict[str, Any]) -> FieldBindings:
    """One rules.mapping record as the registry publishes it."""
    raw = record.get("bindings")
    if not isinstance(raw, dict):
        raw = {}
    paths: dict[str, str] = {}
    label_paths: dict[str, str] = {}
    for field_name, path in raw.items():
        if not field_name or field_name in _STAMPED:
            continue
        if field_name == "labels":
            if isinstance(path, str) and path:
                paths["labels"] = path
            else:
                label_paths = _label_paths(path)
            continue
        if path:
            paths[field_name] = path
    return FieldBindings(
        tenant_id=record["tenant_id"],
        source=record["source"],
        intake=record["intake"],
        paths=paths,
        label_paths=label_paths,
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
