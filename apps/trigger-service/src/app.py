from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi_mcp import FastApiMCP
from faststream.kafka import KafkaBroker

from src.dispatch import build_workflow_manifest
from src.k8s import WorkflowClient
from src.schemas import RunStatusResponse, TriggerEvent, TriggerRequest, TriggerResponse
from src.settings import Settings

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def create_app(settings: Settings, workflow_client: WorkflowClient) -> FastAPI:
    """Factory so tests can inject a fake `WorkflowClient` instead of talking
    to a real cluster, and so FastStream's `TestKafkaBroker` can wrap the
    broker without a real Kafka broker.

    REST (`/trigger`, `/runs/{run_id}`) and the Kafka consumer run in the same
    process — the broker starts/stops as a plain background task on the
    FastAPI app's own lifespan, not a second deploy or a second path a caller
    can reach (see spec.md "Princípio central #2").
    """
    broker = KafkaBroker(settings.kafka_bootstrap_servers)

    @broker.subscriber(settings.kafka_topic, group_id=settings.kafka_group_id)
    async def _consume(raw: dict) -> None:
        try:
            event = TriggerEvent.model_validate(raw)
        except Exception:
            LOGGER.exception("dropping malformed trigger.requests event: %r", raw)
            return

        namespace, manifest = build_workflow_manifest(event)
        try:
            workflow_client.create(namespace, manifest)
        except Exception:
            LOGGER.exception("failed to create Workflow for run_id=%s", event.run_id)
            return

        LOGGER.info("created Workflow trigger-%s in ns/%s", event.run_id, namespace)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await broker.start()
        try:
            yield
        finally:
            await broker.stop()

    app = FastAPI(title="ops-ahead trigger-service", lifespan=lifespan)
    # Exposed so tests can wrap it with faststream's `TestKafkaBroker` instead
    # of talking to a real Kafka broker.
    app.state.kafka_broker = broker

    @app.get("/health", operation_id="health")
    def health() -> dict:
        return {"status": "ok"}

    @app.post("/trigger", response_model=TriggerResponse, status_code=202, operation_id="trigger_analysis")
    async def trigger(request: TriggerRequest) -> TriggerResponse:
        run_id = str(uuid.uuid4())
        event = TriggerEvent(run_id=run_id, request=request)
        await broker.publish(event, settings.kafka_topic)
        return TriggerResponse(run_id=run_id)

    @app.get("/runs/{run_id}", response_model=RunStatusResponse, operation_id="get_run_status")
    def get_run_status(run_id: str) -> RunStatusResponse:
        workflow_name = f"trigger-{run_id}"
        for namespace in settings.run_namespaces:
            workflow = workflow_client.get(namespace, workflow_name)
            if workflow is not None:
                phase = workflow.get("status", {}).get("phase") or "Pending"
                return RunStatusResponse(run_id=run_id, status=phase)

        return RunStatusResponse(run_id=run_id, status="queued")

    # MCP tool derived straight from the FastAPI routes above (task 2.7) —
    # same handler, same Pydantic schema, same Kafka publish path as REST.
    # `/health` is deliberately excluded: it's operational, not a business
    # action an agent should call.
    mcp = FastApiMCP(app, include_operations=["trigger_analysis", "get_run_status"])
    mcp.mount_http()

    return app
