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

#: What an envelope carries when it pins no mapping version.
LATEST_VERSION = "latest"


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
    version, instead of resolving from the envelope."""
    adapter = _ADAPTERS.get(envelope.intake)
    if adapter is None:
        raise UnknownSourceError(f"no adapter for intake={envelope.intake!r}")

    resolved_bindings = bindings.get(envelope.tenant_id, envelope.source)
    if resolved_bindings is None:
        raise UnknownSourceError(
            f"no field bindings for tenant={envelope.tenant_id!r} source={envelope.source!r}"
        )

    resolved = dictionary or _resolve(dictionaries, envelope)
    if resolved is None:
        raise UnknownSourceError(
            f"no mapping version {envelope.version!r} for "
            f"tenant={envelope.tenant_id!r} source={envelope.source!r}"
        )

    body = json.loads(envelope.payload)
    return adapter(envelope, resolved, resolved_bindings, body)


def _resolve(dictionaries: DictionaryRegistry, envelope: EventEnvelope) -> Dictionary | None:
    """The mapping version the envelope asks for. `latest` follows whatever
    the origin is configured with today; anything else pins that version, so
    a backfill of historical data translates by the rules in force when it
    happened rather than by today's."""
    if envelope.version == LATEST_VERSION:
        return dictionaries.latest(envelope.tenant_id, envelope.source)
    return dictionaries.version(envelope.tenant_id, envelope.source, envelope.version)
