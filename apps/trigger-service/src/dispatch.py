from __future__ import annotations

from dataclasses import dataclass

from src.schemas import BreachRiskRequest, TriggerEvent, VolumeForecastRequest

WORKFLOW_API_VERSION = "argoproj.io/v1alpha1"


@dataclass(frozen=True)
class DispatchTarget:
    namespace: str
    workflow_template: str
    entrypoint: str
    parameters: dict[str, str]


# The only place `analysis` (business language) maps to the internal
# WorkflowTemplate/namespace/parameters (Argo/K8s vocabulary) — see
# spec.md "Princípio central #1". `ml.volume`/`ml.breach`/`data.transform`/
# `data.quality` never appear outside this module.
ANALYSIS_TARGETS: dict[str, DispatchTarget] = {
    "volume_forecast": DispatchTarget(
        namespace="ml",
        workflow_template="ml-workflow-template",
        entrypoint="train",
        parameters={"workload": "volume"},
    ),
    "breach_risk": DispatchTarget(
        namespace="ml",
        workflow_template="ml-workflow-template",
        entrypoint="train",
        parameters={"workload": "breach"},
    ),
    "data_refresh": DispatchTarget(
        namespace="data",
        workflow_template="data-pipeline",
        entrypoint="single-step",
        parameters={"step": "transform"},
    ),
    "data_quality_check": DispatchTarget(
        namespace="data",
        workflow_template="data-pipeline",
        entrypoint="single-step",
        parameters={"step": "quality"},
    ),
}


def build_workflow_manifest(event: TriggerEvent) -> tuple[str, dict]:
    """Returns (namespace, manifest) for the `Workflow` the consumer creates.
    `trigger-{run_id}` is deterministic on purpose — GET /runs/{run_id} looks
    it up directly, no auxiliary state needed (see spec.md)."""
    request = event.request
    target = ANALYSIS_TARGETS[request.analysis]

    parameters = dict(target.parameters)
    if isinstance(request, (VolumeForecastRequest, BreachRiskRequest)):
        parameters["train_end"] = request.train_end
        parameters["validation_end"] = request.validation_end
        parameters["holdout_end"] = request.holdout_end
    if request.data_source:
        parameters["clickhouse_url"] = request.data_source

    manifest = {
        "apiVersion": WORKFLOW_API_VERSION,
        "kind": "Workflow",
        "metadata": {
            "name": f"trigger-{event.run_id}",
            "namespace": target.namespace,
            "labels": {"trigger-service/analysis": request.analysis},
        },
        "spec": {
            "workflowTemplateRef": {"name": target.workflow_template},
            "entrypoint": target.entrypoint,
            "arguments": {"parameters": [{"name": k, "value": v} for k, v in parameters.items()]},
        },
    }
    return target.namespace, manifest
