from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from bindings import BindingRegistry, parse_bindings
from config_store import ConfigStore
from dictionaries import Dictionary, DictionaryRegistry

logger = logging.getLogger(__name__)


def apply_mapping(
    bindings: BindingRegistry,
    dictionaries: DictionaryRegistry,
    key: str | None,
    raw: bytes | None,
) -> None:
    """One rules.mapping record: where each field is read and what its values
    mean, applied together. A dictionary entry translating a value says nothing
    without the binding naming the field it comes from, so the two halves are
    one record and are never applied apart.

    An origin that is no longer accepted — a tombstone, or a record marked
    disabled — is forgotten, so a revoked origin stops translating instead of
    running on the last state it happened to have."""
    if _is_tombstone(raw):
        _forget(bindings, key)
        _forget(dictionaries, key)
        return

    record = parse_config_record(raw)
    # A record that cannot be read is skipped, never treated as a removal:
    # dropping an origin's rules on a malformed message would stop translating
    # events the origin is still entitled to send.
    if record is None:
        return

    if record.get("enabled") is False:
        _forget(bindings, key)
        _forget(dictionaries, key)
        return

    try:
        bindings.record(parse_bindings(record))
        dictionaries.record(
            Dictionary(
                tenant_id=record["tenant_id"],
                source=record["source"],
                intake=record["intake"],
                dictionary_version=record["dictionary_version"],
                mappings=record.get("mappings", {}),
            )
        )
    except KeyError:
        logger.warning("rules.mapping record is missing a required field, skipping")


def _is_tombstone(raw: bytes | None) -> bool:
    return not raw


def _forget(registry: BindingRegistry | DictionaryRegistry, key: str | None) -> None:
    tenant_id, _, source = (key or "").partition(":")
    if tenant_id and source:
        registry.forget(tenant_id, source)


def parse_config_record(raw: bytes | None) -> dict[str, Any] | None:
    """Never raises — a malformed record must not stop the rehydration loop.
    None also covers a tombstone, since an empty value parses to nothing."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("config record is not valid json, skipping")
        return None
    return parsed if isinstance(parsed, dict) else None


async def load_config_snapshot(
    bootstrap_servers: str,
    mapping_topic: str,
    idle_timeout_ms: int = 5_000,
) -> tuple[BindingRegistry, DictionaryRegistry]:
    """Reads the compacted mapping topic end to end and returns the state it
    describes. For a batch run (reprocess.py), which has no consumer loop to
    keep the registries current — a long-lived consumer subscribes instead."""
    from aiokafka import AIOKafkaConsumer

    bindings = BindingRegistry()
    dictionaries = DictionaryRegistry()

    consumer = AIOKafkaConsumer(
        mapping_topic,
        bootstrap_servers=bootstrap_servers,
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        # No group: this run reads every partition itself rather than being
        # assigned a share of them.
        group_id=None,
    )
    await consumer.start()
    try:
        while True:
            batch = await consumer.getmany(timeout_ms=idle_timeout_ms)
            # An empty poll means the log is exhausted: a compacted topic is
            # finite, so nothing more is coming for a batch run.
            if not batch:
                break
            for messages in batch.values():
                for message in messages:
                    key = message.key.decode("utf-8") if message.key else None
                    apply_mapping(bindings, dictionaries, key, message.value)
    finally:
        await consumer.stop()

    return bindings, dictionaries


def apply_deadline_rows(key: str | None, raw: bytes | None) -> list[tuple] | None:
    """One rules.deadline record as ClickHouse rows for tenant_deadlines.
    None means the record says nothing to write — a tombstone or a record that
    could not be read."""
    record = _record_for(key, raw)
    if record is None:
        return None
    now = datetime.now(UTC).replace(tzinfo=None)
    return [
        (record["tenant_id"], int(entry["severity"]), int(entry["seconds"]), now)
        for entry in record.get("deadlines", [])
    ]


class ConfigSnapshot:
    """The rows the tenant_* mart tables need from MinIO's rules/deadline and
    rules/target objects. Mappings are written straight into the registries
    the caller already owns — ClickHouse has no equivalent in-process state,
    so its rows are collected instead."""

    def __init__(self) -> None:
        self.deadline_rows: list[tuple] = []
        self.target_rows: list[tuple] = []


def load_snapshot_from_store(
    store: ConfigStore, bindings: BindingRegistry, dictionaries: DictionaryRegistry
) -> ConfigSnapshot:
    """Every rule object in MinIO, applied in the same shape the live topics
    produce. Blocking by design (main.py): a boot that started consuming
    before this finished would translate against an empty or partial
    registry, and translate.py turns that into a dropped event rather than a
    degraded one (spec-config-producao.md#o-boot-do-data-ingest-é-bloqueante)."""
    snapshot = ConfigSnapshot()
    for object_key, record in store.load_all():
        raw = json.dumps(record).encode("utf-8")
        if object_key.startswith("rules/mapping/"):
            apply_mapping(bindings, dictionaries, _origin_key(record), raw)
        elif object_key.startswith("rules/deadline/"):
            rows = apply_deadline_rows(None, raw)
            if rows:
                snapshot.deadline_rows.extend(rows)
        elif object_key.startswith("rules/target/"):
            rows = apply_target_rows(None, raw)
            if rows:
                snapshot.target_rows.extend(rows)
    return snapshot


def _origin_key(record: dict[str, Any]) -> str | None:
    tenant_id, source = record.get("tenant_id"), record.get("source")
    return f"{tenant_id}:{source}" if tenant_id and source else None


def apply_target_rows(key: str | None, raw: bytes | None) -> list[tuple] | None:
    """One rules.target record as ClickHouse rows for tenant_kpi_targets.
    `severities` stores as-is — the band a tenant defines as [1,2] is one row,
    not one row per severity, since achievement is scored on the band."""
    record = _record_for(key, raw)
    if record is None:
        return None
    now = datetime.now(UTC).replace(tzinfo=None)
    return [
        (
            record["tenant_id"],
            [int(s) for s in entry["severities"]],
            int(entry["max_breaches"]),
            float(entry["achievement_pct"]),
            now,
        )
        for entry in record.get("targets", [])
    ]


def _record_for(key: str | None, raw: bytes | None) -> dict[str, Any] | None:
    if not raw:
        return None
    record = parse_config_record(raw)
    if record is None or "tenant_id" not in record:
        return None
    return record
