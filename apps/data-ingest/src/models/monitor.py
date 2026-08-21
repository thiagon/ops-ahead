from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class BronzeMonitorEvent(BaseModel):
    """Mirrors contracts/condition-monitor.schema.json — an observed condition,
    no owner, no acknowledgment, no deadline."""

    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field(description="Same id as the raw envelope this was translated from.")]
    tenant_id: Annotated[str, Field(min_length=1)]
    source: Annotated[str, Field()]
    version: Annotated[str, Field(description="Translated contract version.")]
    dictionary_version: Annotated[str, Field(description="Version of the dictionary that produced this line.")]
    received_at: Annotated[AwareDatetime, Field()]
    external_id: Annotated[str, Field(description="Identity in the origin.")]
    started_at: Annotated[AwareDatetime, Field()]
    ended_at: Annotated[AwareDatetime | None, Field(default=None, description="Null while the condition persists.")]
    severity: Annotated[int | None, Field(default=None, ge=1, le=5)]
    condition: Annotated[str, Field(description="firing/cleared, translated.")]
    entity_id: Annotated[str, Field(description="Only correlation key between the alert and monitor chains.")]
    title: Annotated[str | None, Field(default=None)]
    description: Annotated[str | None, Field(default=None)]
    labels: Annotated[dict[str, str] | None, Field(default=None)]
    source_url: Annotated[str | None, Field(default=None)]
