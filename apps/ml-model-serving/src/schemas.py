from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---- /predict/volume ------------------------------------------------------
# Mirrors ml-volume-model's VolumeForecastModel.predict() input contract: one
# row per priority_group, the *as-of* date, and the LightGBM lag/rolling
# features computed up to that date. Calendar features for the target date
# (D+1/D+7) are computed inside the model itself, not supplied here.


class VolumeFeatureInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    priority_group: Literal["total", "p1", "p2", "p3"]
    date: datetime
    avg_opened_hour: float
    lag_1: float
    lag_7: float
    lag_14: float
    roll_mean_7: float
    roll_mean_30: float


class VolumePredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    features: list[VolumeFeatureInput] = Field(min_length=1)


class VolumeForecast(BaseModel):
    priority_group: str
    horizon: int
    yhat: float
    yhat_lower: float
    yhat_upper: float


class VolumePredictResponse(BaseModel):
    forecasts: list[VolumeForecast]


# ---- /predict/breach -------------------------------------------------------
# Mirrors ml-breach-model's breach.features.FEATURE_COLUMNS exactly — the caller
# is responsible for assembling these (P4 precursor, group load, etc.); this
# service is the model I/O boundary, not a feature-computation service (see
# conductor/tracks/ml-models_20260806/plan.md, Phase 4 notes).


class BreachFeatureInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: int = Field(ge=1, le=3)
    owner: str
    opened_hour: int = Field(ge=0, le=23)
    opened_dayofweek: int = Field(ge=0, le=6)
    is_manual_open: int = Field(ge=0, le=1)
    p4_precursor_present: int = Field(ge=0, le=1)
    p4_precursor_length: int = Field(ge=0)
    no_intervention_count_1h: int = Field(ge=0)
    no_intervention_count_6h: int = Field(ge=0)
    group_load: int = Field(ge=0)
    was_recategorized: int = Field(ge=0, le=1)
    recategorization_count: int = Field(ge=0)
    group_severity_historical_ola_ratio: float | None = None
    group_severity_historical_over_25pct_rate: float | None = None
    consumed_ratio: float = Field(ge=0)
    time_remaining_seconds: float
    was_acknowledged: int = Field(ge=0, le=1)
    entity_signal_count_15m: int = Field(ge=0)
    entity_signal_count_1h: int = Field(ge=0)
    entity_auto_resolution_rate: float | None = None
    entity_severity_escalations: int = Field(ge=0)


class ShapContribution(BaseModel):
    feature: str
    shap_value: float


class BreachPredictResponse(BaseModel):
    breach_probability: float = Field(ge=0.0, le=1.0)
    shap_top5: list[ShapContribution]
