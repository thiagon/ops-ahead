from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class IncidentAlertEvent(BaseModel):
    """Same shape as data-ingest's own model (contracts/incident-alert.schema.json)
    — duplicated rather than imported, consistent with how every consumer in
    this track ships as its own container image. This app reacts to the alert
    chain: a managed incident with lifecycle, owner and a contractual
    deadline (domain/ubiquitous-language.md#incident), never the monitor
    chain's conditions."""

    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field(description="Same id as the raw envelope this was translated from.")]
    tenant_id: Annotated[str, Field(min_length=1)]
    source: Annotated[str, Field(examples=["itsm", "opsgenie", "pagerduty"])]
    version: Annotated[str, Field(description="Translated contract version.")]
    dictionary_version: Annotated[str, Field()]
    received_at: Annotated[AwareDatetime, Field()]
    external_id: Annotated[str, Field()]
    opened_at: Annotated[AwareDatetime, Field()]
    acknowledged_at: Annotated[AwareDatetime | None, Field(default=None)]
    resolved_at: Annotated[AwareDatetime | None, Field(default=None)]
    closed_at: Annotated[AwareDatetime | None, Field(default=None)]
    severity: Annotated[int, Field(ge=1, le=5, description="Normalized severity: 1=Critical … 5=VeryLow.")]
    status: Annotated[
        str,
        Field(
            description="open/in_progress/waiting/resolved/closed/canceled/unknown, translated.",
        ),
    ]
    entity_id: Annotated[str | None, Field(default=None)]
    title: Annotated[str, Field()]
    description: Annotated[str | None, Field(default=None)]
    owner: Annotated[str | None, Field(default=None)]
    reported_by: Annotated[str | None, Field(default=None)]
    parent_id: Annotated[str | None, Field(default=None)]
    resolution_code: Annotated[str | None, Field(default=None)]
    resolution_summary: Annotated[str | None, Field(default=None)]
    labels: Annotated[dict[str, str] | None, Field(default=None)]
    source_url: Annotated[str | None, Field(default=None)]
