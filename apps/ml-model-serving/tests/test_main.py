import pandas as pd
from fastapi.testclient import TestClient

from src.main import create_app
from src.models_loader import ModelRegistry
from src.settings import Settings


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
    def predict(self, model_input: pd.DataFrame) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "breach_probability": 0.42,
                    "shap_top5": [
                        {"feature": "p4_precursor_present", "shap_value": 0.31},
                        {"feature": "group_load_1h", "shap_value": 0.12},
                    ],
                }
            ]
        )


def _client_with_loaded_models() -> TestClient:
    registry = ModelRegistry(Settings())
    registry.volume_model = FakeVolumeModel()
    registry.breach_model = FakeBreachModel()
    app = create_app(registry, load_on_startup=False)
    return TestClient(app)


def test_health_reports_models_loaded():
    client = _client_with_loaded_models()
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["volume_model_loaded"] is True
    assert body["breach_model_loaded"] is True


def test_health_reports_models_not_loaded_before_startup():
    registry = ModelRegistry(Settings())
    app = create_app(registry, load_on_startup=False)
    client = TestClient(app)

    response = client.get("/health")
    assert response.json()["volume_model_loaded"] is False


def test_predict_volume_returns_both_horizons():
    client = _client_with_loaded_models()
    payload = {
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
    response = client.post("/predict/volume", json=payload)
    assert response.status_code == 200
    forecasts = response.json()["forecasts"]
    horizons = {f["horizon"] for f in forecasts}
    assert horizons == {1, 7}


def test_predict_volume_rejects_malformed_request():
    client = _client_with_loaded_models()
    response = client.post("/predict/volume", json={"features": []})
    assert response.status_code == 422


def test_predict_breach_returns_calibrated_score_and_shap():
    client = _client_with_loaded_models()
    payload = {
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
    response = client.post("/predict/breach", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert 0.0 <= body["breach_probability"] <= 1.0
    assert len(body["shap_top5"]) == 2
    assert body["shap_top5"][0]["feature"] == "p4_precursor_present"


def test_predict_breach_sends_numeric_dtypes_for_nullable_fields():
    # A single-row DataFrame built from a dict with a lone None value infers
    # `object` dtype for that column, not float64+NaN — real LightGBM rejects
    # it outright (FakeBreachModel above doesn't care, so it can't catch
    # this). group_severity_historical_ola_ratio/_over_25pct_rate are the
    # two fields that can legitimately arrive as null.
    captured: list[pd.DataFrame] = []

    class _SpyBreachModel:
        def predict(self, model_input: pd.DataFrame) -> pd.DataFrame:
            captured.append(model_input)
            return pd.DataFrame([{"breach_probability": 0.1, "shap_top5": []}])

    registry = ModelRegistry(Settings())
    registry.volume_model = FakeVolumeModel()
    registry.breach_model = _SpyBreachModel()
    client = TestClient(create_app(registry, load_on_startup=False))

    response = client.post(
        "/predict/breach",
        json={
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
        },
    )

    assert response.status_code == 200
    dtypes = captured[0][["group_severity_historical_ola_ratio", "group_severity_historical_over_25pct_rate"]].dtypes
    assert all(dt.kind == "f" for dt in dtypes)


def test_predict_breach_503_when_model_not_loaded():
    registry = ModelRegistry(Settings())
    app = create_app(registry, load_on_startup=False)
    client = TestClient(app)

    response = client.post(
        "/predict/breach",
        json={
            "severity": 1,
            "assignment_group": "Team14",
            "opened_hour": 1,
            "opened_dayofweek": 1,
            "is_manual_open": 0,
            "p4_precursor_present": 0,
            "p4_precursor_length": 0,
            "no_intervention_count_1h": 0,
            "no_intervention_count_6h": 0,
            "group_load_1h": 0,
            "was_recategorized": 0,
            "recategorization_count": 0,
        },
    )
    assert response.status_code == 503
