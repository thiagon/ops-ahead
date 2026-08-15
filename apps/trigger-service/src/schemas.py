from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

# Business-language contract only — no Argo/Kubernetes vocabulary (workflow,
# template, namespace, pod, job) ever appears here. src/dispatch.py is the one
# place that translates `analysis` into the internal WorkflowTemplate +
# namespace + parameters (see spec.md "Princípio central #1").


class VolumeForecastRequest(BaseModel):
    analysis: Literal["volume_forecast"]
    train_end: str
    validation_end: str
    holdout_end: str
    data_source: str | None = None


class BreachRiskRequest(BaseModel):
    analysis: Literal["breach_risk"]
    train_end: str
    validation_end: str
    holdout_end: str
    data_source: str | None = None


class DataRefreshRequest(BaseModel):
    analysis: Literal["data_refresh"]
    data_source: str | None = None


class DataQualityCheckRequest(BaseModel):
    analysis: Literal["data_quality_check"]
    data_source: str | None = None


TriggerRequest = Annotated[
    Union[VolumeForecastRequest, BreachRiskRequest, DataRefreshRequest, DataQualityCheckRequest],
    Field(discriminator="analysis"),
]


class TriggerEvent(BaseModel):
    """What the intake publishes to `trigger.requests` — the validated request
    plus the `run_id` generated at intake time, so the consumer never has to
    invent the Workflow's name itself."""

    run_id: str
    request: TriggerRequest


class TriggerResponse(BaseModel):
    run_id: str


class RunStatusResponse(BaseModel):
    run_id: str
    status: Literal["queued", "Pending", "Running", "Succeeded", "Failed", "Error"]
