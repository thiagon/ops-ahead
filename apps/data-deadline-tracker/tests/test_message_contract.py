from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from faststream.kafka import TestKafkaBroker

from main import build_app
from settings import Settings

# What data-ingest puts on events.alert: BronzeAlertEvent.model_dump_json().
# Kept as the literal wire payload rather than built from the model, so a
# change on either side shows up here as a mismatch instead of tracking it.
WIRE_EVENT = {
    "event_id": "bcdda1ca-cc11-4f4e-9a0d-2b1e7d3c5ab7",
    "tenant_id": "locaweb",
    "source": "service_now",
    "external_id": "INC1",
    "entity_id": "IC00001",
    "opened_at": "2026-01-01T00:00:00Z",
    "acknowledged_at": None,
    "severity": 2,
    "status": "open",
    "parent_id": None,
    "resolution_code": None,
}


class _FakeClient:
    def execute(self, query: str, params: dict | None = None):
        return []


@pytest.mark.asyncio
async def test_alert_handler_accepts_the_payload_data_ingest_publishes(monkeypatch):
    """The handler is typed with IncidentAlertEvent, so publishing the JSON as
    a str hands it the raw text where it expects a mapping — an error no test
    calling apply_event() directly can reach."""
    monkeypatch.setattr("main.Client", lambda *a, **kw: _FakeClient())
    settings = Settings(clickhouse_url="clickhouse://user@localhost/db")
    app, broker = build_app(settings)

    async with TestKafkaBroker(broker):
        await broker.publish(
            json.dumps(WIRE_EVENT).encode(),
            settings.kafka_topic_alert,
        )
