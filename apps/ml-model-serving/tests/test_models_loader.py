from src.models_loader import ModelRegistry
from src.settings import Settings


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
