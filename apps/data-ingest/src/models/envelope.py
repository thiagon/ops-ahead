from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class EventEnvelope(BaseModel):
    """Mirrors contracts/event-envelope.schema.json. The payload is opaque —
    nothing inside it is typed here; translation reads it per source."""

    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field(description="Globally unique event identifier (UUID v4).")]
    tenant_id: Annotated[str, Field(min_length=1, description="Assigned from the credential that signed the request.")]
    source: Annotated[str, Field(description="Origin adapter identifier, assigned by the route.")]
    intake: Annotated[str, Field(description="alert or monitor — assigned by the route.")]
    version: Annotated[str, Field(description="Envelope format version.")]
    received_at: Annotated[AwareDatetime, Field(description="When the gateway accepted the event.")]
    payload: Annotated[str, Field(description="The origin's body, verbatim, as a JSON string.")]
