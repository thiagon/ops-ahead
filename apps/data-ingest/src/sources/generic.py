from __future__ import annotations

from typing import Any

from bindings import FieldBindings, at
from dictionaries import Dictionary
from models import BronzeAlertEvent, BronzeMonitorEvent, EventEnvelope
from time_utils import normalize_to_utc


def _opt_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _opt_datetime(value: Any):
    text = _opt_str(value)
    return normalize_to_utc(text) if text else None


def _labels(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    labels = {str(key): text for key, item in value.items() if (text := _opt_str(item))}
    return labels or None


def _collect_labels(bindings: FieldBindings, body: dict[str, Any]) -> dict[str, str] | None:
    """Join several origin fields into the bronze map, or take a map the
    origin already sends at a single path."""
    if bindings.label_paths:
        labels = {
            key: text
            for key, path in bindings.label_paths.items()
            if (text := _opt_str(at(body, path)))
        }
        return labels or None
    return _labels(bindings.value(body, "labels"))


def _severity(dictionary: Dictionary, raw: Any) -> int | None:
    """The origin grades severity on its own scale, so the label it sends is
    translated like any other vocabulary (domain/acl/itsm.md). An origin
    already sending 1–5 needs no mapping — the value passes through."""
    if raw is None:
        return None
    translated = dictionary.translate("severity", str(raw), default=None)
    try:
        return int(translated if translated is not None else raw)
    except (TypeError, ValueError):
        return None


def translate_alert(
    envelope: EventEnvelope,
    dictionary: Dictionary,
    bindings: FieldBindings,
    body: dict[str, Any],
) -> BronzeAlertEvent:
    """One event in, one bronze row out — raw field names resolved through the
    origin's bindings, values through its dictionary, no derivation."""
    def read(field: str) -> Any:
        return bindings.value(body, field)

    return BronzeAlertEvent(
        event_id=envelope.event_id,
        tenant_id=envelope.tenant_id,
        source=envelope.source,
        version="v1",
        dictionary_version=dictionary.version,
        received_at=envelope.received_at,
        external_id=str(read("external_id")),
        opened_at=normalize_to_utc(str(read("opened_at"))),
        acknowledged_at=_opt_datetime(read("acknowledged_at")),
        resolved_at=_opt_datetime(read("resolved_at")),
        closed_at=_opt_datetime(read("closed_at")),
        severity=_severity(dictionary, read("severity")),
        status=dictionary.translate("status", _opt_str(read("status")), default="unknown"),
        entity_id=_opt_str(read("entity_id")),
        title=str(read("title") or ""),
        description=_opt_str(read("description")),
        owner=_opt_str(read("owner")),
        reported_by=dictionary.translate("reported_by", _opt_str(read("reported_by")), default=None),
        parent_id=_opt_str(read("parent_id")),
        resolution_code=dictionary.translate(
            "resolution_code", _opt_str(read("resolution_code")), default=None
        ),
        resolution_summary=_opt_str(read("resolution_summary")),
        labels=_collect_labels(bindings, body),
        source_url=_opt_str(read("source_url")),
    )


def translate_monitor(
    envelope: EventEnvelope,
    dictionary: Dictionary,
    bindings: FieldBindings,
    body: dict[str, Any],
) -> BronzeMonitorEvent:
    def read(field: str) -> Any:
        return bindings.value(body, field)

    return BronzeMonitorEvent(
        event_id=envelope.event_id,
        tenant_id=envelope.tenant_id,
        source=envelope.source,
        version="v1",
        dictionary_version=dictionary.version,
        received_at=envelope.received_at,
        external_id=str(read("external_id")),
        started_at=normalize_to_utc(str(read("started_at"))),
        ended_at=_opt_datetime(read("ended_at")),
        severity=_severity(dictionary, read("severity")),
        condition=dictionary.translate("condition", _opt_str(read("condition")), default="firing"),
        entity_id=str(read("entity_id")),
        title=_opt_str(read("title")),
        description=_opt_str(read("description")),
        labels=_collect_labels(bindings, body),
        source_url=_opt_str(read("source_url")),
    )
