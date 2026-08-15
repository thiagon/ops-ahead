from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from faststream.kafka import TestKafkaBroker


@pytest.mark.asyncio
async def test_trigger_accepts_valid_payload_and_returns_run_id(app):
    async with TestKafkaBroker(app.state.kafka_broker):
        with TestClient(app) as client:
            response = client.post(
                "/trigger",
                json={
                    "analysis": "volume_forecast",
                    "train_end": "2025-09-30",
                    "validation_end": "2025-10-31",
                    "holdout_end": "2026-01-31",
                },
            )

    assert response.status_code == 202
    body = response.json()
    assert body["run_id"]


@pytest.mark.asyncio
async def test_trigger_rejects_volume_forecast_without_dates(app):
    async with TestKafkaBroker(app.state.kafka_broker):
        with TestClient(app) as client:
            response = client.post("/trigger", json={"analysis": "volume_forecast"})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_trigger_rejects_unknown_analysis(app):
    async with TestKafkaBroker(app.state.kafka_broker):
        with TestClient(app) as client:
            response = client.post("/trigger", json={"analysis": "not_a_real_analysis"})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_trigger_generates_a_fresh_run_id_per_call(app):
    async with TestKafkaBroker(app.state.kafka_broker):
        with TestClient(app) as client:
            first = client.post("/trigger", json={"analysis": "data_refresh"})
            second = client.post("/trigger", json={"analysis": "data_refresh"})

    assert first.json()["run_id"] != second.json()["run_id"]


@pytest.mark.asyncio
async def test_health(app):
    async with TestKafkaBroker(app.state.kafka_broker):
        with TestClient(app) as client:
            response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
