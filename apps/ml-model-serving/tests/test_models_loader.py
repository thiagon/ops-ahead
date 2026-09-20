import pytest

from models_loader import (
    ModelNotFoundForTenant,
    ModelRegistry,
    ModelVersionNotFound,
    registered_model_name,
)
from settings import Settings


def _registry(monkeypatch, load_model) -> ModelRegistry:
    monkeypatch.setattr("mlflow.set_tracking_uri", lambda *_: None)
    monkeypatch.setattr("mlflow.pyfunc.load_model", load_model)
    registry = ModelRegistry(Settings())
    registry.load()
    return registry


def test_the_naming_rule_matches_the_one_ml_trainer_registers_under():
    """Both apps ship as separate images and duplicate this rule; if they
    disagree, inference silently finds no model at all."""
    from pathlib import Path

    trainer = (
        Path(__file__).resolve().parents[2] / "ml-trainer" / "src" / "model_names.py"
    ).read_text()

    assert 'SEPARATOR = "__"' in trainer
    assert registered_model_name("volume-forecast", "locaweb") == "volume-forecast__locaweb"


def test_startup_does_not_depend_on_any_tenant_having_a_promoted_model(monkeypatch):
    """Readiness means "able to serve", not "found every model" — with one
    model per tenant, eager loading would tie the pod to all of them."""

    def _never_called(*args, **kwargs):
        raise AssertionError("load() must not fetch a model")

    registry = _registry(monkeypatch, _never_called)

    assert registry._cache == {}


def test_each_tenant_resolves_its_own_model(monkeypatch):
    seen: list[str] = []

    def _load(uri: str):
        seen.append(uri)
        return object()

    registry = _registry(monkeypatch, _load)
    registry.volume_model_for("locaweb")
    registry.volume_model_for("acme")

    assert seen == [
        "models:/volume-forecast__locaweb/Production",
        "models:/volume-forecast__acme/Production",
    ]


def test_a_resolved_model_is_cached_per_tenant(monkeypatch):
    calls: list[str] = []

    def _load(uri: str):
        calls.append(uri)
        return object()

    registry = _registry(monkeypatch, _load)
    first = registry.breach_model_for("locaweb")
    second = registry.breach_model_for("locaweb")

    assert first is second
    assert len(calls) == 1


def test_a_tenant_without_a_promoted_model_errors_rather_than_serving_another(monkeypatch):
    """The failure this exists to prevent: a plausible probability computed by
    somebody else's model, which no log would flag."""

    def _raise(*args, **kwargs):
        raise Exception("RESOURCE_DOES_NOT_EXIST")

    registry = _registry(monkeypatch, _raise)

    with pytest.raises(ModelNotFoundForTenant) as excinfo:
        registry.breach_model_for("acme")

    assert "acme" in str(excinfo.value)


def test_an_unknown_requested_version_is_a_different_error_from_a_missing_tenant(monkeypatch):
    def _raise(*args, **kwargs):
        raise Exception("version not found")

    registry = _registry(monkeypatch, _raise)

    with pytest.raises(ModelVersionNotFound):
        registry.volume_model_for("locaweb", "42")


def test_a_requested_version_is_cached_apart_from_production(monkeypatch):
    seen: list[str] = []

    def _load(uri: str):
        seen.append(uri)
        return object()

    registry = _registry(monkeypatch, _load)
    registry.volume_model_for("locaweb")
    registry.volume_model_for("locaweb", "7")

    assert seen == [
        "models:/volume-forecast__locaweb/Production",
        "models:/volume-forecast__locaweb/7",
    ]
