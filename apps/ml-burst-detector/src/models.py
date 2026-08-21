from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class BronzeMonitorEvent(BaseModel):
    """Same shape as data-ingest's own model (contracts/condition-monitor.schema.json)
    — duplicated rather than imported, consistent with how every training job
    in this track ships as its own container image. This detector reads the
    monitor chain: it reacts to observed condition signal, not to managed
    incident lifecycle (domain/ubiquitous-language.md#condition)."""

    model_config = ConfigDict(extra="forbid")

    event_id: Annotated[UUID, Field(description="Same id as the raw envelope this was translated from.")]
    tenant_id: Annotated[str, Field(min_length=1)]
    source: Annotated[str, Field(examples=["alertmanager", "datadog", "zabbix"])]
    version: Annotated[str, Field(description="Translated contract version.")]
    dictionary_version: Annotated[str, Field()]
    received_at: Annotated[AwareDatetime, Field()]
    external_id: Annotated[str, Field()]
    started_at: Annotated[AwareDatetime, Field()]
    ended_at: Annotated[AwareDatetime | None, Field(default=None)]
    severity: Annotated[int | None, Field(default=None, ge=1, le=5)]
    condition: Annotated[str, Field(description="firing/cleared, translated.")]
    entity_id: Annotated[str, Field(description="Only correlation key between the alert and monitor chains.")]
    title: Annotated[str | None, Field(default=None)]
    description: Annotated[str | None, Field(default=None)]
    labels: Annotated[dict[str, str] | None, Field(default=None)]
    source_url: Annotated[str | None, Field(default=None)]


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
