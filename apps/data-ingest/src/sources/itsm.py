from __future__ import annotations

from typing import Any

from dictionaries import Dictionary
from models import BronzeAlertEvent, EventEnvelope
from time_utils import normalize_to_utc

#: ITSM's own field names, as scripts/incident_producer.py posts them
#: (domain/acl/itsm.md — the origin's own vocabulary, read only in this
#: module). The dictionary's mapping keys are the domain field names instead
#: (contracts/translation-dictionary.schema.json) — the two happen to share a
#: name for status, but not for reported_by, so they are kept distinct here.
_ORIGIN_STATUS_FIELD = "status"
_ORIGIN_REPORTED_BY_FIELD = "opened_by"


def _opt_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _opt_datetime(value: Any):
    text = _opt_str(value)
    return normalize_to_utc(text) if text else None


def translate_alert(envelope: EventEnvelope, dictionary: Dictionary, body: dict[str, Any]) -> BronzeAlertEvent:
    """ITSM's ACL adapter: raw field names, translated dictionary values, no
    derivation — one event in, one bronze row out."""
    raw_status = body.get(_ORIGIN_STATUS_FIELD)
    raw_reported_by = body.get(_ORIGIN_REPORTED_BY_FIELD)

    labels: dict[str, str] = {}
    for field in ("product", "category", "subcategory"):
        value = _opt_str(body.get(field))
        if value:
            labels[field] = value

    return BronzeAlertEvent(
        event_id=envelope.event_id,
        tenant_id=envelope.tenant_id,
        source=envelope.source,
        version="v1",
        dictionary_version=dictionary.dictionary_version,
        received_at=envelope.received_at,
        external_id=str(body["ticket_number"]),
        opened_at=normalize_to_utc(str(body["opened_at"])),
        resolved_at=_opt_datetime(body.get("resolved_at")),
        closed_at=_opt_datetime(body.get("closed_at")),
        severity=int(body["priority_code"]),
        status=dictionary.translate("status", raw_status, default="unknown"),
        entity_id=_opt_str(body.get("configuration_item")),
        title=str(body.get("short_description") or ""),
        owner=_opt_str(body.get("assignment_group")),
        reported_by=dictionary.translate("reported_by", raw_reported_by, default=None),
        parent_id=_opt_str(body.get("parent_incident")),
        resolution_code=dictionary.translate("resolution_code", raw_status, default=None),
        resolution_summary=_opt_str(body.get("resolution")),
        labels=labels or None,
    )
