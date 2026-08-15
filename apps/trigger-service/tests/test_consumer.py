from __future__ import annotations

import pytest
from faststream.kafka import TestKafkaBroker

from src.schemas import TriggerEvent


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "request_payload,expected_namespace,expected_template,expected_entrypoint,expected_params",
    [
        (
            {
                "analysis": "volume_forecast",
                "train_end": "2025-09-30",
                "validation_end": "2025-10-31",
                "holdout_end": "2026-01-31",
            },
            "ml",
            "ml-workflow-template",
            "train",
            {"workload": "volume", "train_end": "2025-09-30", "validation_end": "2025-10-31", "holdout_end": "2026-01-31"},
        ),
        (
            {
                "analysis": "breach_risk",
                "train_end": "2025-02-15",
                "validation_end": "2025-03-15",
                "holdout_end": "2025-04-09",
            },
            "ml",
            "ml-workflow-template",
            "train",
            {"workload": "breach", "train_end": "2025-02-15", "validation_end": "2025-03-15", "holdout_end": "2025-04-09"},
        ),
        (
            {"analysis": "data_refresh"},
            "data",
            "data-pipeline",
            "single-step",
            {"step": "transform"},
        ),
        (
            {"analysis": "data_quality_check"},
            "data",
            "data-pipeline",
            "single-step",
            {"step": "quality"},
        ),
    ],
)
async def test_consumer_maps_analysis_to_workflow_template(
    app,
    fake_workflow_client,
    request_payload,
    expected_namespace,
    expected_template,
    expected_entrypoint,
    expected_params,
):
    event = TriggerEvent(run_id="abc-123", request=request_payload)

    async with TestKafkaBroker(app.state.kafka_broker):
        await app.state.kafka_broker.publish(event, "trigger.requests")

    assert len(fake_workflow_client.created) == 1
    namespace, manifest = fake_workflow_client.created[0]

    assert namespace == expected_namespace
    assert manifest["metadata"]["name"] == "trigger-abc-123"
    assert manifest["spec"]["workflowTemplateRef"]["name"] == expected_template
    assert manifest["spec"]["entrypoint"] == expected_entrypoint

    params = {p["name"]: p["value"] for p in manifest["spec"]["arguments"]["parameters"]}
    assert params == expected_params


@pytest.mark.asyncio
async def test_consumer_uses_data_source_override_as_clickhouse_url(app, fake_workflow_client):
    event = TriggerEvent(
        run_id="run-2",
        request={"analysis": "data_refresh", "data_source": "clickhouse://user:pw@host:9000/other"},
    )

    async with TestKafkaBroker(app.state.kafka_broker):
        await app.state.kafka_broker.publish(event, "trigger.requests")

    _, manifest = fake_workflow_client.created[0]
    params = {p["name"]: p["value"] for p in manifest["spec"]["arguments"]["parameters"]}
    assert params["clickhouse_url"] == "clickhouse://user:pw@host:9000/other"


@pytest.mark.asyncio
async def test_consumer_does_not_crash_on_malformed_event(app, fake_workflow_client):
    async with TestKafkaBroker(app.state.kafka_broker):
        # Missing "request" entirely — must not raise, must not create a Workflow.
        await app.state.kafka_broker.publish({"run_id": "broken"}, "trigger.requests")
        # The topic must still work for the next, well-formed event.
        await app.state.kafka_broker.publish(
            TriggerEvent(run_id="fine", request={"analysis": "data_refresh"}), "trigger.requests"
        )

    assert len(fake_workflow_client.created) == 1
    _, manifest = fake_workflow_client.created[0]
    assert manifest["metadata"]["name"] == "trigger-fine"
