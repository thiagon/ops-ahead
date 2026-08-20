from __future__ import annotations

import json

from dictionaries import Dictionary, DictionaryRegistry
from models import BronzeAlertEvent, BronzeMonitorEvent, EventEnvelope
from sources.itsm import translate_alert

#: One adapter per (source, intake) — adding an origin is adding an entry
#: here, nothing else changes (domain/acl/itsm.md#adicionar-uma-origem).
_ALERT_ADAPTERS = {"itsm": translate_alert}
_MONITOR_ADAPTERS: dict[str, object] = {}


class UnknownSourceError(Exception):
    pass


def translate(
    envelope: EventEnvelope,
    dictionaries: DictionaryRegistry,
    dictionary: Dictionary | None = None,
) -> BronzeAlertEvent | BronzeMonitorEvent:
    """Translate one envelope. `dictionary` pins a specific version — used by
    reprocess.py to reproduce what translation would have decided at a given
    version, instead of always reading the latest."""
    adapters = _ALERT_ADAPTERS if envelope.intake == "alert" else _MONITOR_ADAPTERS
    adapter = adapters.get(envelope.source)
    if adapter is None:
        raise UnknownSourceError(f"no adapter for source={envelope.source!r} intake={envelope.intake!r}")

    resolved = dictionary or dictionaries.latest(envelope.tenant_id, envelope.source)
    if resolved is None:
        raise UnknownSourceError(
            f"no dictionary for tenant={envelope.tenant_id!r} source={envelope.source!r}"
        )

    body = json.loads(envelope.payload)
    return adapter(envelope, resolved, body)
