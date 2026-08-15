from __future__ import annotations

import pytest

from src.app import create_app
from src.settings import Settings


class FakeWorkflowClient:
    """In-memory stand-in for `src.k8s.WorkflowClient` — no real cluster."""

    def __init__(self) -> None:
        self.created: list[tuple[str, dict]] = []
        self._by_key: dict[tuple[str, str], dict] = {}

    def create(self, namespace: str, manifest: dict) -> dict:
        self.created.append((namespace, manifest))
        key = (namespace, manifest["metadata"]["name"])
        self._by_key[key] = manifest
        return manifest

    def get(self, namespace: str, name: str) -> dict | None:
        return self._by_key.get((namespace, name))

    def seed(self, namespace: str, name: str, phase: str | None) -> None:
        self._by_key[(namespace, name)] = {"status": ({"phase": phase} if phase else {})}


@pytest.fixture
def fake_workflow_client() -> FakeWorkflowClient:
    return FakeWorkflowClient()


@pytest.fixture
def settings() -> Settings:
    return Settings(kafka_bootstrap_servers="localhost:9092")


@pytest.fixture
def app(settings, fake_workflow_client):
    return create_app(settings, fake_workflow_client)
