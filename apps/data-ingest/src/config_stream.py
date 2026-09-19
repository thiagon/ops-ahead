from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from bindings import BindingRegistry, parse_bindings
from dictionaries import Dictionary, DictionaryRegistry

logger = logging.getLogger(__name__)


def apply_origin(registry: BindingRegistry, key: str | None, raw: bytes | None) -> None:
    """One config.origin record. An origin that is no longer accepted — a
    tombstone, or a record marked disabled — is forgotten, so a revoked origin
    stops translating instead of running on the last state it happened to
    have."""
    if _is_tombstone(raw):
        _forget(registry, key)
        return

    record = _load(raw)
    # A record that cannot be read is skipped, never treated as a removal:
    # dropping an origin's configuration on a malformed message would stop
    # translating events the origin is still entitled to send.
    if record is None:
        return

    if record.get("enabled") is False:
        _forget(registry, key)
        return

    try:
        registry.record(parse_bindings(record))
    except KeyError:
        logger.warning("config.origin record is missing a required field, skipping")


def apply_dictionary(registry: DictionaryRegistry, key: str | None, raw: bytes | None) -> None:
    if _is_tombstone(raw):
        _forget(registry, key)
        return

    record = _load(raw)
    if record is None:
        return

    try:
        registry.record(
            Dictionary(
                tenant_id=record["tenant_id"],
                source=record["source"],
                intake=record["intake"],
                dictionary_version=record["dictionary_version"],
                mappings=record.get("mappings", {}),
            )
        )
    except KeyError:
        logger.warning("config.dictionary record is missing a required field, skipping")


def _is_tombstone(raw: bytes | None) -> bool:
    return not raw


def _forget(registry: BindingRegistry | DictionaryRegistry, key: str | None) -> None:
    tenant_id, _, source = (key or "").partition(":")
    if tenant_id and source:
        registry.forget(tenant_id, source)


def _load(raw: bytes | None) -> dict[str, Any] | None:
    """Never raises — a malformed record must not stop the rehydration loop."""
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("config record is not valid json, skipping")
        return None
    return parsed if isinstance(parsed, dict) else None


async def load_config_snapshot(
    bootstrap_servers: str,
    origin_topic: str,
    dictionary_topic: str,
    idle_timeout_ms: int = 5_000,
) -> tuple[BindingRegistry, DictionaryRegistry]:
    """Reads both compacted topics end to end and returns the state they
    describe. For a batch run (reprocess.py), which has no consumer loop to
    keep the registries current — a long-lived consumer subscribes instead."""
    from aiokafka import AIOKafkaConsumer

    bindings = BindingRegistry()
    dictionaries = DictionaryRegistry()

    consumer = AIOKafkaConsumer(
        origin_topic,
        dictionary_topic,
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
            for partition, messages in batch.items():
                for message in messages:
                    key = message.key.decode("utf-8") if message.key else None
                    if partition.topic == origin_topic:
                        apply_origin(bindings, key, message.value)
                    else:
                        apply_dictionary(dictionaries, key, message.value)
    finally:
        await consumer.stop()

    return bindings, dictionaries


def apply_deadline_rows(key: str | None, raw: bytes | None) -> list[tuple] | None:
    """One config.deadline record as ClickHouse rows for tenant_deadlines.
    None means the record says nothing to write — a tombstone or a record that
    could not be read."""
    record = _record_for(key, raw)
    if record is None:
        return None
    now = datetime.now(UTC).replace(tzinfo=None)
    return [
        (record["tenant_id"], int(entry["severity"]), int(entry["deadline_seconds"]), now)
        for entry in record.get("deadlines", [])
    ]


def apply_kpi_target_rows(key: str | None, raw: bytes | None) -> list[tuple] | None:
    """One config.kpi-target record as ClickHouse rows for tenant_kpi_targets."""
    record = _record_for(key, raw)
    if record is None:
        return None
    now = datetime.now(UTC).replace(tzinfo=None)
    return [
        (
            record["tenant_id"],
            entry["kpi_group"],
            int(entry["max_breaches"]),
            float(entry["achievement_pct"]),
            now,
        )
        for entry in record.get("targets", [])
    ]


def _record_for(key: str | None, raw: bytes | None) -> dict[str, Any] | None:
    if not raw:
        return None
    record = _load(raw)
    if record is None or "tenant_id" not in record:
        return None
    return record
