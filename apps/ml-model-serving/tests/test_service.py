import pandas as pd
import pytest
from starlette.requests import Request
from starlette.testclient import TestClient

import bentoml
from models_loader import ModelVersionNotFound
from schemas import BreachFeatureInput, VolumePredictRequest
from service import ModelNotLoaded, ModelServing, RequestedModelVersionNotFound

VOLUME_PAYLOAD = {
    "features": [
        {
            "priority_group": "total",
            "date": "2026-01-15T00:00:00Z",
            "avg_opened_hour": 12.0,
            "lag_1": 10,
            "lag_7": 9,
            "lag_14": 8,
            "roll_mean_7": 9.5,
            "roll_mean_30": 9.0,
        }
    ]
}

BREACH_PAYLOAD = {
    "severity": 2,
    "assignment_group": "Team14",
    "opened_hour": 10,
    "opened_dayofweek": 2,
    "is_manual_open": 0,
    "p4_precursor_present": 1,
    "p4_precursor_length": 3,
    "no_intervention_count_1h": 0,
    "no_intervention_count_6h": 1,
    "group_load_1h": 5,
    "was_recategorized": 0,
    "recategorization_count": 0,
}


class FakeVolumeModel:
    def predict(self, model_input: pd.DataFrame) -> pd.DataFrame:
        rows = []
        for _, row in model_input.iterrows():
            for horizon in (1, 7):
                rows.append(
                    {
                        "priority_group": row["priority_group"],
                        "horizon": horizon,
                        "yhat": 10.0 * horizon,
                        "yhat_lower": 8.0 * horizon,
                        "yhat_upper": 12.0 * horizon,
                    }
                )
        return pd.DataFrame(rows)


class FakeBreachModel:
    def __init__(self, probability: float = 0.42):
        self.probability = probability

    def predict(self, model_input: pd.DataFrame) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "breach_probability": self.probability,
                    "shap_top5": [
                        {"feature": "p4_precursor_present", "shap_value": 0.31},
                        {"feature": "group_load_1h", "shap_value": 0.12},
                    ],
                }
            ]
        )


def _request_with_headers(headers: dict[str, str] | None = None) -> Request:
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "headers": raw_headers})


def _ctx(headers: dict[str, str] | None = None):
    ctx = bentoml.Context()
    return ctx, ctx.in_request(_request_with_headers(headers))


# `ModelServing()` is instantiated directly (bypassing `to_asgi()`) so each
# test controls exactly what `ModelRegistry.load()` sees, without going
# through BentoML's HTTP layer — which registers its own Prometheus
# collectors on the process-global registry once per ASGI app and errors out
# on a second `to_asgi()` call within the same test session (see
# test_predict_volume_and_breach_over_http below, the one test that does
# build the ASGI app).
def _service(monkeypatch, load_model) -> ModelServing:
    monkeypatch.setattr("models_loader.mlflow.set_tracking_uri", lambda *_: None)
    monkeypatch.setattr("models_loader.mlflow.pyfunc.load_model", load_model)
    return ModelServing()


def _production_load_model(uri: str):
    if "volume-forecast" in uri:
        return FakeVolumeModel()
    if "breach-risk" in uri:
        return FakeBreachModel()
    raise Exception(f"unexpected model uri: {uri}")


def test_predict_volume_returns_both_horizons(monkeypatch):
    service = _service(monkeypatch, _production_load_model)
    ctx, in_request = _ctx()
    with in_request:
        response = service.predict_volume(VolumePredictRequest(**VOLUME_PAYLOAD), ctx)
    horizons = {f.horizon for f in response.forecasts}
    assert horizons == {1, 7}


def test_predict_breach_without_header_uses_production(monkeypatch):
    service = _service(monkeypatch, _production_load_model)
    ctx, in_request = _ctx()
    with in_request:
        response = service.predict_breach(BreachFeatureInput(**BREACH_PAYLOAD), ctx)
    assert response.breach_probability == pytest.approx(0.42)


def test_predict_breach_with_header_uses_requested_version(monkeypatch):
    def _versioned_load_model(uri: str):
        if uri.endswith("/Production"):
            return FakeBreachModel(probability=0.42)
        if uri.endswith("/7"):
            return FakeBreachModel(probability=0.9)
        raise Exception(f"unexpected model uri: {uri}")

    service = _service(monkeypatch, _versioned_load_model)
    ctx, in_request = _ctx({"X-Model-Version": "7"})
    with in_request:
        response = service.predict_breach(BreachFeatureInput(**BREACH_PAYLOAD), ctx)
    assert response.breach_probability == pytest.approx(0.9)


def test_predict_breach_with_unknown_version_raises_client_error(monkeypatch):
    def _versioned_load_model(uri: str):
        if uri.endswith("/Production"):
            return FakeBreachModel()
        raise Exception("RESOURCE_DOES_NOT_EXIST")

    service = _service(monkeypatch, _versioned_load_model)
    ctx, in_request = _ctx({"X-Model-Version": "999"})
    with in_request, pytest.raises(RequestedModelVersionNotFound):
        service.predict_breach(BreachFeatureInput(**BREACH_PAYLOAD), ctx)


def test_predict_breach_raises_when_production_not_loaded(monkeypatch):
    def _always_raise(uri: str):
        raise Exception("RESOURCE_DOES_NOT_EXIST")

    service = _service(monkeypatch, _always_raise)
    ctx, in_request = _ctx()
    with in_request, pytest.raises(ModelNotLoaded):
        service.predict_breach(BreachFeatureInput(**BREACH_PAYLOAD), ctx)


def test_model_registry_raises_model_version_not_found_directly(monkeypatch):
    # predict_breach/predict_volume translate this into the HTTP-mapped
    # RequestedModelVersionNotFound — this confirms the lower layer they
    # both wrap actually raises it.
    def _raise(uri: str):
        raise Exception("boom")

    service = _service(monkeypatch, _raise)
    with pytest.raises(ModelVersionNotFound):
        service.registry.breach_model_for("42")


def test_predict_volume_and_breach_over_http(monkeypatch):
    # The one HTTP-level test in this module — building the ASGI app twice
    # in one process trips a Prometheus "duplicated timeseries" error inside
    # BentoML's own instrumentation, so every other scenario above is
    # exercised as a direct method call instead. `/metrics` itself isn't
    # exercised here: BentoML's `PrometheusClient` reads
    # `PROMETHEUS_MULTIPROC_DIR` once at import time (not per-request), so a
    # `monkeypatch.setenv` inside a test has no effect — the Dockerfile sets
    # it for real before the process starts.
    monkeypatch.setattr("models_loader.mlflow.set_tracking_uri", lambda *_: None)
    monkeypatch.setattr("models_loader.mlflow.pyfunc.load_model", _production_load_model)

    app = ModelServing.to_asgi()
    with TestClient(app) as client:
        assert client.get("/livez").status_code == 200
        assert client.get("/readyz").status_code == 200

        volume_response = client.post("/predict/volume", json=VOLUME_PAYLOAD)
        assert volume_response.status_code == 200
        assert {f["horizon"] for f in volume_response.json()["forecasts"]} == {1, 7}

        breach_response = client.post("/predict/breach", json=BREACH_PAYLOAD)
        assert breach_response.status_code == 200
        assert breach_response.json()["breach_probability"] == pytest.approx(0.42)

        malformed_response = client.post("/predict/volume", json={"features": []})
        assert malformed_response.status_code == 400
