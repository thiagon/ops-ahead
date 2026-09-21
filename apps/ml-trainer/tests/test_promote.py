from __future__ import annotations

import pytest

import promote
from settings import Settings


class _FakeVersion:
    def __init__(self, run_id: str, version: str):
        self.run_id = run_id
        self.version = version


class _FakeClient:
    def __init__(self, versions=()):
        self._versions = list(versions)
        self.searched: list[str] = []
        self.created: list[tuple[str, str]] = []
        self.transitioned: list[tuple[str, str, str]] = []

    def search_model_versions(self, filter_string):
        self.searched.append(filter_string)
        return list(self._versions)

    def create_model_version(self, name, source, run_id):
        self.created.append((name, run_id))
        return _FakeVersion(run_id, "7")

    def transition_model_version_stage(self, name, version, stage, archive_existing_versions):
        self.transitioned.append((name, version, stage))


@pytest.fixture
def settings() -> Settings:
    return Settings(mlflow_tracking_uri="sqlite:///unused.db")


def test_promotes_under_the_name_that_carries_the_tenant(monkeypatch, settings):
    fake = _FakeClient(versions=[_FakeVersion("run-1", "3")])
    monkeypatch.setattr(promote.mlflow, "MlflowClient", lambda tracking_uri: fake)

    promote.promote_run(settings, "volume", "locaweb", "run-1")

    assert fake.transitioned == [("volume-forecast__locaweb", "3", "Production")]


def test_two_tenants_promote_independently(monkeypatch, settings):
    fake = _FakeClient(versions=[_FakeVersion("run-2", "5")])
    monkeypatch.setattr(promote.mlflow, "MlflowClient", lambda tracking_uri: fake)

    promote.promote_run(settings, "breach", "acme", "run-2")

    assert fake.transitioned == [("breach-risk__acme", "5", "Production")]


def test_registers_the_run_when_no_version_exists_yet(monkeypatch, settings):
    fake = _FakeClient(versions=[])
    monkeypatch.setattr(promote.mlflow, "MlflowClient", lambda tracking_uri: fake)

    promote.promote_run(settings, "volume", "locaweb", "run-3")

    assert fake.created == [("volume-forecast__locaweb", "run-3")]
    assert fake.transitioned == [("volume-forecast__locaweb", "7", "Production")]
