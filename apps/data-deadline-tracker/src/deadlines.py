from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class DeadlineTable:
    """(tenant_id, severity) -> deadline_seconds. Rehydrated from the compacted
    rules.deadline topic, the same rules silver_alert joins against —
    never a constant here (domain/ubiquitous-language.md#tenant)."""

    def __init__(self) -> None:
        self._deadlines: dict[tuple[str, int], int] = {}

    def record(self, tenant_id: str, deadlines: dict[int, int]) -> None:
        """A record carries a tenant's whole set, so the tenant's previous
        entries are replaced rather than merged — a severity dropped upstream
        must stop having a deadline here too."""
        self._deadlines = {
            key: value for key, value in self._deadlines.items() if key[0] != tenant_id
        }
        self._deadlines.update({(tenant_id, severity): value for severity, value in deadlines.items()})

    def forget(self, tenant_id: str) -> None:
        self._deadlines = {
            key: value for key, value in self._deadlines.items() if key[0] != tenant_id
        }

    def get(self, tenant_id: str, severity: int) -> int | None:
        return self._deadlines.get((tenant_id, severity))

    def __len__(self) -> int:
        return len(self._deadlines)


def apply_deadline(table: DeadlineTable, key: str | None, raw: bytes | None) -> None:
    """One rules.deadline record, keyed by tenant_id."""
    if not raw:
        if key:
            table.forget(key)
        return

    record = _load(raw)
    # A record that cannot be read is skipped, never treated as a removal:
    # dropping a tenant's deadlines on a malformed message would stop every
    # milestone for incidents that still have one.
    if record is None:
        return

    try:
        table.record(
            record["tenant_id"],
            {int(entry["severity"]): int(entry["deadline_seconds"]) for entry in record["deadlines"]},
        )
    except (KeyError, TypeError, ValueError):
        logger.warning("rules.deadline record is malformed, skipping")


def _load(raw: bytes) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("rules.deadline record is not valid json, skipping")
        return None
    return parsed if isinstance(parsed, dict) else None
