from __future__ import annotations

import json

from bindings import BindingRegistry
from dictionaries import Dictionary, DictionaryRegistry
from models import BronzeAlertEvent, BronzeMonitorEvent, EventEnvelope
from sources.generic import translate_alert, translate_monitor

#: One adapter per intake, not per origin: which fields an origin sends and
#: what its values mean are configuration, so adding an origin never touches
#: this file (domain/acl/itsm.md#adicionar-uma-origem).
_ADAPTERS = {"alert": translate_alert, "monitor": translate_monitor}


class UnknownSourceError(Exception):
    pass


def translate(
    envelope: EventEnvelope,
    dictionaries: DictionaryRegistry,
    bindings: BindingRegistry,
    dictionary: Dictionary | None = None,
) -> BronzeAlertEvent | BronzeMonitorEvent:
    """Translate one envelope. `dictionary` pins a specific version — used by
    reprocess.py to reproduce what translation would have decided at a given
    version, instead of always reading the latest."""
    adapter = _ADAPTERS.get(envelope.intake)
    if adapter is None:
        raise UnknownSourceError(f"no adapter for intake={envelope.intake!r}")

    resolved_bindings = bindings.get(envelope.tenant_id, envelope.source)
    if resolved_bindings is None:
        raise UnknownSourceError(
            f"no field bindings for tenant={envelope.tenant_id!r} source={envelope.source!r}"
        )

    resolved = dictionary or dictionaries.latest(envelope.tenant_id, envelope.source)
    if resolved is None:
        raise UnknownSourceError(
            f"no dictionary for tenant={envelope.tenant_id!r} source={envelope.source!r}"
        )

    body = json.loads(envelope.payload)
    return adapter(envelope, resolved, resolved_bindings, body)
