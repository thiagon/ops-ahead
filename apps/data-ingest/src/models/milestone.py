from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

MilestoneKind = Literal["pct_25", "pct_50", "pct_75", "pct_100", "abandoned"]


class MilestoneEvent(BaseModel):
    """Mirrors contracts/deadline-milestone.schema.json — already the
    canonical shape published by apps/data-deadline-tracker, so unlike
    alert/monitor there is no raw topic, no lake write, no translation:
    this consumer only lands it in bronze_deadline_milestone."""

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
