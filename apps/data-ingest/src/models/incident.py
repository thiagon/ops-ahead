from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class IncidentRaw(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field(description="Globally unique event identifier (UUID v4).")]
    source: Annotated[str, Field(description="Origin adapter identifier.", examples=["itsm-locaweb", "alertmanager", "datadog"])]
    received_at: Annotated[AwareDatetime, Field(description="Timestamp when the consumer received the event (UTC, ISO 8601).")]
    opened_at: Annotated[AwareDatetime, Field(description="Timestamp when the incident was opened in the originating system (UTC, ISO 8601).")]
    severity: Annotated[int, Field(description="Normalized severity: 1=Critical … 5=VeryLow.", ge=1, le=5)]
    entity_id: Annotated[str, Field(description="Identifier of the affected IC, host, or service.")]
    status: Annotated[str, Field(description="Current status in the originating system.")]
    payload_raw: Annotated[str, Field(description="Full original event as JSON string, verbatim from the originating system.")]
