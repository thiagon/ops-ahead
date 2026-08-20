from __future__ import annotations

from clickhouse_driver import Client


class DeadlineTable:
    """(tenant_id, severity) -> deadline_seconds, loaded from data-runner's
    tenant_deadlines seed — the same per-tenant configuration silver_alert
    joins against, never a constant here either
    (domain/ubiquitous-language.md#tenant)."""

    def __init__(self) -> None:
        self._deadlines: dict[tuple[str, int], int] = {}

    def refresh(self, client: Client) -> None:
        rows = client.execute("SELECT tenant_id, severity, deadline_seconds FROM tenant_deadlines")
        self._deadlines = {(tenant_id, severity): deadline for tenant_id, severity, deadline in rows}

    def get(self, tenant_id: str, severity: int) -> int | None:
        return self._deadlines.get((tenant_id, severity))
