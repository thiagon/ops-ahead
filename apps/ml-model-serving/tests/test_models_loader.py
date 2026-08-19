import pytest

from models_loader import ModelRegistry, ModelVersionNotFound
from settings import Settings


def test_load_survives_a_model_not_yet_in_production(monkeypatch):
    """A model with no Production version yet is a normal startup state
    (nothing has been promoted), not a crash — see models_loader.py."""

    def _raise(*args, **kwargs):
        raise Exception("RESOURCE_DOES_NOT_EXIST: Registered Model with name=volume-forecast not found")

    monkeypatch.setattr("mlflow.pyfunc.load_model", _raise)
    monkeypatch.setattr("mlflow.set_tracking_uri", lambda *_: None)

    registry = ModelRegistry(Settings())
    registry.load()  # must not raise

    assert registry.volume_model is None
    assert registry.breach_model is None


def test_load_sets_only_the_model_that_succeeds(monkeypatch):
    def _load(uri, *args, **kwargs):
        if "breach" in uri:
            raise Exception("not found")
        return "fake-volume-model"

    monkeypatch.setattr("mlflow.pyfunc.load_model", _load)
    monkeypatch.setattr("mlflow.set_tracking_uri", lambda *_: None)

    registry = ModelRegistry(Settings())
    registry.load()

    assert registry.volume_model == "fake-volume-model"
    assert registry.breach_model is None


def test_model_for_version_returns_production_when_no_version_requested():
    registry = ModelRegistry(Settings())
    registry.volume_model = "production-volume-model"

    assert registry.volume_model_for(None) == "production-volume-model"


def test_model_for_version_loads_and_caches_the_requested_version(monkeypatch):
    calls: list[str] = []

    def _load(uri, *args, **kwargs):
        calls.append(uri)
        return f"model-at-{uri}"

    monkeypatch.setattr("mlflow.pyfunc.load_model", _load)

    registry = ModelRegistry(Settings())
    first = registry.volume_model_for("3")
    second = registry.volume_model_for("3")

    assert first == second == "model-at-models:/volume-forecast/3"
    assert calls == ["models:/volume-forecast/3"]  # cached, loaded once


def test_model_for_version_raises_when_version_does_not_exist(monkeypatch):
    def _raise(*args, **kwargs):
        raise Exception("RESOURCE_DOES_NOT_EXIST")

    monkeypatch.setattr("mlflow.pyfunc.load_model", _raise)

    registry = ModelRegistry(Settings())
    with pytest.raises(ModelVersionNotFound):
        registry.breach_model_for("999")
