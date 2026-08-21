from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

MilestoneKind = Literal["pct_25", "pct_50", "pct_75", "pct_100", "abandoned"]

PCT_THRESHOLDS: dict[MilestoneKind, int] = {
    "pct_25": 25,
    "pct_50": 50,
    "pct_75": 75,
    "pct_100": 100,
}


class IncidentAlertEvent(BaseModel):
    """Mirrors contracts/incident-alert.schema.json — only the fields the
    tracker needs are typed here; the rest of the payload is ignored (same
    reasoning as every other consumer in this track: duplicated per-app
    rather than shared, since each ships as its own container image)."""

    model_config = ConfigDict(extra="ignore")

    tenant_id: Annotated[str, Field(min_length=1)]
    source: Annotated[str, Field()]
    external_id: Annotated[str, Field()]
    entity_id: Annotated[str | None, Field(default=None)]
    opened_at: Annotated[AwareDatetime, Field()]
    acknowledged_at: Annotated[AwareDatetime | None, Field(default=None)]
    severity: Annotated[int, Field(ge=1, le=5)]
    status: Annotated[str, Field()]
    parent_id: Annotated[str | None, Field(default=None)]
    resolution_code: Annotated[str | None, Field(default=None)]


class MilestoneEvent(BaseModel):
    """Mirrors contracts/deadline-milestone.schema.json."""

    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field()]
    tenant_id: Annotated[str, Field(min_length=1)]
    source: Annotated[str, Field()]
    external_id: Annotated[str, Field()]
    entity_id: Annotated[str | None, Field(default=None)]
    kind: Annotated[MilestoneKind, Field()]
    severity: Annotated[int, Field(ge=1, le=5)]
    opened_at: Annotated[AwareDatetime, Field()]
    acknowledged_at: Annotated[AwareDatetime | None, Field(default=None)]
    due_at: Annotated[AwareDatetime, Field()]
    deadline_seconds: Annotated[int, Field(ge=0)]
    consumed_ratio: Annotated[float, Field(ge=0)]
    occurred_at: Annotated[AwareDatetime, Field()]
