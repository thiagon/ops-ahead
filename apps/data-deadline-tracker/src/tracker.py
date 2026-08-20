from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from clickhouse_driver import Client

from deadlines import DeadlineTable
from models import PCT_THRESHOLDS, IncidentAlertEvent, MilestoneEvent, MilestoneKind

OccurrenceKey = tuple[str, str, str]  # (tenant_id, source, external_id)

TERMINAL_STATUSES = {"resolved", "closed", "canceled"}


def _key(tenant_id: str, source: str, external_id: str) -> OccurrenceKey:
    return (tenant_id, source, external_id)


def _as_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@dataclass
class OccurrenceState:
    tenant_id: str
    source: str
    external_id: str
    entity_id: str | None
    severity: int
    opened_at: datetime
    acknowledged_at: datetime | None = None
    emitted: set[MilestoneKind] = field(default_factory=set)


class OccurrenceTracker:
    """The open-occurrence set and the milestone-crossing logic — the
    acompanhador's actual clock. Kept purely in memory: `reconstruct` is
    what makes a restart safe without depending on any cache being warm
    (Fase 6, task 6.10)."""

    def __init__(self, deadlines: DeadlineTable, abandoned_ratio: float) -> None:
        self._occurrences: dict[OccurrenceKey, OccurrenceState] = {}
        self._deadlines = deadlines
        self._abandoned_ratio = abandoned_ratio

    def __len__(self) -> int:
        return len(self._occurrences)

    def apply_event(self, event: IncidentAlertEvent) -> None:
        """Opens, updates, or stops tracking an occurrence. A severity
        change never resets `emitted` — a milestone already fired stays
        fired; `check()` picks up whatever newly crosses under the new
        deadline, including jumping straight to pct_100 (spec: "os marcos
        são recalculados, não continuados")."""
        key = _key(event.tenant_id, event.source, event.external_id)

        if event.status in TERMINAL_STATUSES:
            # Closing stops tracking — no further milestone for this
            # occurrence (task 6.7).
            self._occurrences.pop(key, None)
            return

        state = self._occurrences.get(key)
        if state is None:
            self._occurrences[key] = OccurrenceState(
                tenant_id=event.tenant_id,
                source=event.source,
                external_id=event.external_id,
                entity_id=event.entity_id,
                severity=event.severity,
                opened_at=event.opened_at,
                acknowledged_at=event.acknowledged_at,
            )
        else:
            state.severity = event.severity
            state.acknowledged_at = event.acknowledged_at
            state.entity_id = event.entity_id

    def reconstruct(self, client: Client) -> None:
        """Seeds the open set from silver_alert_open — the tracker's read
        path is exactly this view (see
        apps/data-runner/models/silver/silver_alert_open.sql). Any
        threshold already crossed as of now is marked emitted WITHOUT
        publishing — a restart must not re-announce a milestone that, from
        the system's perspective, already happened before it came back up."""
        rows = client.execute(
            "SELECT tenant_id, source, external_id, entity_id, severity, "
            "opened_at, acknowledged_at, consumed_ratio "
            "FROM silver_alert_open"
        )
        self._occurrences.clear()
        for tenant_id, source, external_id, entity_id, severity, opened_at, acknowledged_at, consumed_ratio in rows:
            state = OccurrenceState(
                tenant_id=tenant_id,
                source=source,
                external_id=external_id,
                entity_id=entity_id or None,
                severity=severity,
                opened_at=_as_aware(opened_at),
                acknowledged_at=_as_aware(acknowledged_at) if acknowledged_at else None,
            )
            ratio = consumed_ratio or 0.0
            for kind, pct in PCT_THRESHOLDS.items():
                if ratio * 100 >= pct:
                    state.emitted.add(kind)
            if ratio >= self._abandoned_ratio:
                state.emitted.add("abandoned")
            self._occurrences[_key(tenant_id, source, external_id)] = state

    def check(self, now: datetime) -> list[MilestoneEvent]:
        """Sweeps every open occurrence for newly-crossed milestones. Safe
        to call repeatedly — `emitted` is monotonic per occurrence, so
        nothing already announced fires again."""
        milestones: list[MilestoneEvent] = []
        for state in self._occurrences.values():
            deadline_seconds = self._deadlines.get(state.tenant_id, state.severity)
            if not deadline_seconds:
                continue

            elapsed_seconds = (now - state.opened_at).total_seconds()
            consumed_ratio = elapsed_seconds / deadline_seconds
            due_at = state.opened_at + timedelta(seconds=deadline_seconds)

            for kind, pct in PCT_THRESHOLDS.items():
                if kind in state.emitted:
                    continue
                if consumed_ratio * 100 >= pct:
                    state.emitted.add(kind)
                    milestones.append(_milestone(state, kind, due_at, deadline_seconds, consumed_ratio, now))

            if "abandoned" not in state.emitted and consumed_ratio >= self._abandoned_ratio:
                state.emitted.add("abandoned")
                milestones.append(_milestone(state, "abandoned", due_at, deadline_seconds, consumed_ratio, now))

        return milestones


def _milestone(
    state: OccurrenceState,
    kind: MilestoneKind,
    due_at: datetime,
    deadline_seconds: int,
    consumed_ratio: float,
    now: datetime,
) -> MilestoneEvent:
    return MilestoneEvent(
        event_id=uuid4(),
        tenant_id=state.tenant_id,
        source=state.source,
        external_id=state.external_id,
        entity_id=state.entity_id,
        kind=kind,
        severity=state.severity,
        opened_at=state.opened_at,
        acknowledged_at=state.acknowledged_at,
        due_at=due_at,
        deadline_seconds=deadline_seconds,
        consumed_ratio=consumed_ratio,
        occurred_at=now,
    )
