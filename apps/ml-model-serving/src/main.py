from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, HTTPException
from prometheus_client import make_asgi_app

from models_loader import ModelRegistry
from schemas import (
    BreachFeatureInput,
    BreachPredictResponse,
    ShapContribution,
    VolumeForecast,
    VolumePredictRequest,
    VolumePredictResponse,
)
from settings import Settings

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def create_app(registry: ModelRegistry, load_on_startup: bool = True) -> FastAPI:
    """Factory so tests can inject a `ModelRegistry` with mocked models
    instead of hitting a real MLflow server — `load_on_startup=False` skips
    the startup hook entirely for that case."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if load_on_startup:
            registry.load()
        yield

    app = FastAPI(title="ops-ahead model-serving", lifespan=lifespan)
    app.mount("/metrics", make_asgi_app())

    @app.get("/health")
    def health() -> dict:
        return {
            "status": "ok",
            "volume_model_loaded": registry.volume_model is not None,
            "breach_model_loaded": registry.breach_model is not None,
        }

    @app.post("/predict/volume", response_model=VolumePredictResponse)
    def predict_volume(request: VolumePredictRequest) -> VolumePredictResponse:
        if registry.volume_model is None:
            raise HTTPException(status_code=503, detail="volume model not loaded")

        model_input = pd.DataFrame([f.model_dump() for f in request.features])
        result = registry.volume_model.predict(model_input)

        forecasts = [
            VolumeForecast(
                priority_group=row["priority_group"],
                horizon=int(row["horizon"]),
                yhat=float(row["yhat"]),
                yhat_lower=float(row["yhat_lower"]),
                yhat_upper=float(row["yhat_upper"]),
            )
            for _, row in result.iterrows()
        ]
        return VolumePredictResponse(forecasts=forecasts)

    @app.post("/predict/breach", response_model=BreachPredictResponse)
    def predict_breach(request: BreachFeatureInput) -> BreachPredictResponse:
        if registry.breach_model is None:
            raise HTTPException(status_code=503, detail="breach model not loaded")

        model_input = pd.DataFrame([request.model_dump()])
        # A single-row frame infers `object` dtype for a column whose only
        # value is None (the legitimate "no prior history" case) instead of
        # float64+NaN — LightGBM rejects object dtypes outright.
        nullable_float_columns = ["group_severity_historical_ola_ratio", "group_severity_historical_over_25pct_rate"]
        model_input[nullable_float_columns] = model_input[nullable_float_columns].apply(pd.to_numeric)
        result = registry.breach_model.predict(model_input)
        row = result.iloc[0]

        shap_top5 = [ShapContribution(**item) for item in row["shap_top5"]]
        return BreachPredictResponse(breach_probability=float(row["breach_probability"]), shap_top5=shap_top5)

    return app


def main() -> None:
    import uvicorn

    settings = Settings()
    registry = ModelRegistry(settings)
    app = create_app(registry)
    uvicorn.run(app, host="0.0.0.0", port=settings.http_port)


if __name__ == "__main__":
    main()
