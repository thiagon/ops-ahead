from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class IncidentEvent(BaseModel):
    """Same shape as data-ingest's own model (contracts/incident-event.schema.json)
    — duplicated rather than imported, consistent with how every training job
    in this track ships as its own container image."""

    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field(description="Globally unique event identifier (UUID v4).")]
    source: Annotated[str, Field(description="Origin adapter identifier.", examples=["itsm", "alertmanager", "datadog"])]
    received_at: Annotated[AwareDatetime, Field(description="Timestamp when the consumer received the event (UTC, ISO 8601).")]
    opened_at: Annotated[AwareDatetime, Field(description="Timestamp when the incident was opened in the originating system (UTC, ISO 8601).")]
    severity: Annotated[int, Field(description="Normalized severity: 1=Critical … 5=VeryLow.", ge=1, le=5)]
    entity_id: Annotated[str, Field(description="Identifier of the affected IC, host, or service.")]
    status: Annotated[str, Field(description="Current status in the originating system.")]
    payload_raw: Annotated[str, Field(description="Full original event as JSON string, verbatim from the originating system.")]


class BurstAlert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entity_id: str
    alert_type: Annotated[str, Field(description="'spike' (z-score) or 'regime_change' (CUSUM).")]
    window_name: Annotated[str, Field(description="Which tracked window triggered this alert: '15m', '1h', or '6h'.")]
    z_score: float | None = None
    current_count: int
    median: float
    mad: float
    detected_at: AwareDatetime
