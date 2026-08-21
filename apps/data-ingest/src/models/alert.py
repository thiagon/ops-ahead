from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class BronzeAlertEvent(BaseModel):
    """Mirrors contracts/incident-alert.schema.json — one row per event, no
    dedup, no derivation. Identity is (tenant_id, source, external_id)."""

    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field(description="Same id as the raw envelope this was translated from.")]
    tenant_id: Annotated[str, Field(min_length=1)]
    source: Annotated[str, Field()]
    version: Annotated[str, Field(description="Translated contract version.")]
    dictionary_version: Annotated[str, Field(description="Version of the dictionary that produced this line.")]
    received_at: Annotated[AwareDatetime, Field()]
    external_id: Annotated[str, Field(description="Identity in the origin, e.g. a ticket number.")]
    opened_at: Annotated[AwareDatetime, Field()]
    acknowledged_at: Annotated[AwareDatetime | None, Field(default=None)]
    resolved_at: Annotated[AwareDatetime | None, Field(default=None)]
    closed_at: Annotated[AwareDatetime | None, Field(default=None)]
    severity: Annotated[int, Field(ge=1, le=5)]
    status: Annotated[str, Field(description="Lifecycle only — open/in_progress/waiting/resolved/closed/canceled/unknown.")]
    entity_id: Annotated[str | None, Field(default=None)]
    title: Annotated[str, Field()]
    description: Annotated[str | None, Field(default=None)]
    owner: Annotated[str | None, Field(default=None)]
    reported_by: Annotated[str | None, Field(default=None, description="automatic/manual, translated.")]
    parent_id: Annotated[str | None, Field(default=None)]
    resolution_code: Annotated[str | None, Field(default=None, description="How the incident ended, translated.")]
    resolution_summary: Annotated[str | None, Field(default=None)]
    labels: Annotated[dict[str, str] | None, Field(default=None)]
    source_url: Annotated[str | None, Field(default=None)]
