from __future__ import annotations

import logging
from http import HTTPStatus

import pandas as pd
from prometheus_client import Counter

import bentoml
from bentoml.exceptions import BentoMLException, InvalidArgument
from models_loader import ModelNotFoundForTenant, ModelRegistry, ModelVersionNotFound
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

# Every prediction, whether served by the default Production model or a
# specific version requested through the A/B header — the label is what lets
# the two be compared side by side on the same dashboard.
PREDICTIONS_TOTAL = Counter(
    "model_serving_predictions_total",
    "Predictions served, by model and resolved version",
    labelnames=["model", "version"],
)

MODEL_VERSION_HEADER = "x-model-version"


class ModelNotLoaded(BentoMLException):
    """No Production version has been promoted yet and no version was requested — see models_loader.py."""

    error_code = HTTPStatus.SERVICE_UNAVAILABLE


class RequestedModelVersionNotFound(InvalidArgument):
    """The version named in the A/B header doesn't exist in the MLflow registry."""


@bentoml.service
class ModelServing:
    def __init__(self) -> None:
        self.settings = Settings()
        self.registry = ModelRegistry(self.settings)
        self.registry.load()

    @bentoml.api(route="/predict/volume")
    def predict_volume(self, request: VolumePredictRequest, /, ctx: bentoml.Context) -> VolumePredictResponse:
        # `request` is positional-only so BentoML treats the whole Pydantic
        # model as the raw request body (matching the pre-BentoML FastAPI
        # contract) instead of nesting it under a `"request"` key — see
        # `IODescriptor.from_input`'s `positional_only_param` branch.
        version = ctx.request.headers.get(MODEL_VERSION_HEADER)
        try:
            model = self.registry.volume_model_for(request.tenant_id, version)
        except ModelVersionNotFound as exc:
            raise RequestedModelVersionNotFound(str(exc)) from exc
        except ModelNotFoundForTenant as exc:
            raise ModelNotLoaded(str(exc)) from exc

        model_input = pd.DataFrame([f.model_dump() for f in request.features])
        result = model.predict(model_input)

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
        PREDICTIONS_TOTAL.labels(model="volume", version=version or "production").inc()
        return VolumePredictResponse(forecasts=forecasts)

    @bentoml.api(route="/predict/breach")
    def predict_breach(self, request: BreachFeatureInput, /, ctx: bentoml.Context) -> BreachPredictResponse:
        version = ctx.request.headers.get(MODEL_VERSION_HEADER)
        try:
            model = self.registry.breach_model_for(request.tenant_id, version)
        except ModelVersionNotFound as exc:
            raise RequestedModelVersionNotFound(str(exc)) from exc
        except ModelNotFoundForTenant as exc:
            raise ModelNotLoaded(str(exc)) from exc

        # tenant_id selected the model; it is not one of its features.
        model_input = pd.DataFrame([request.model_dump(exclude={"tenant_id"})])
        # A single-row frame infers `object` dtype for a column whose only
        # value is None (the legitimate "no prior history" case) instead of
        # float64+NaN — LightGBM rejects object dtypes outright.
        nullable_float_columns = ["group_severity_historical_ola_ratio", "group_severity_historical_over_25pct_rate"]
        model_input[nullable_float_columns] = model_input[nullable_float_columns].apply(pd.to_numeric)
        result = model.predict(model_input)
        row = result.iloc[0]

        shap_top5 = [ShapContribution(**item) for item in row["shap_top5"]]
        PREDICTIONS_TOTAL.labels(model="breach", version=version or "production").inc()
        return BreachPredictResponse(breach_probability=float(row["breach_probability"]), shap_top5=shap_top5)
