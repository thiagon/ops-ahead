from __future__ import annotations

import mlflow.pyfunc
import pandas as pd

from src.volume import features


class VolumeForecastModel(mlflow.pyfunc.PythonModel):
    """Bundles, per horizon, the LightGBM model, one Prophet model per
    `priority_group`, and the ensemble weight chosen on validation.

    `model_input` needs one row per `priority_group` with the *as-of* date and
    the LightGBM lag/rolling features computed up to that date (see
    `src.features.add_lag_features`) — calendar features for the target date
    are computed internally per horizon, not supplied by the caller.
    """

    def __init__(self, lgb_models, prophet_models, ensemble_weights):
        self.lgb_models = lgb_models
        self.prophet_models = prophet_models
        self.ensemble_weights = ensemble_weights

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        model_input = model_input.copy()
        model_input["date"] = pd.to_datetime(model_input["date"])
        model_input = model_input.reset_index(drop=True)

        rows = []
        for horizon, lgb_model in self.lgb_models.items():
            featured = model_input.copy()
            featured["target_date"] = featured["date"] + pd.Timedelta(days=horizon)
            featured = features.add_fourier_features(featured, date_column="target_date")
            featured = features.add_holiday_flag(featured, date_column="target_date")

            x = featured[features.FEATURE_COLUMNS].copy()
            x["priority_group"] = x["priority_group"].astype("category")
            lgb_preds = lgb_model.predict(x)

            weight = self.ensemble_weights[horizon]
            for i, row in model_input.iterrows():
                group = row["priority_group"]
                prophet_model = self.prophet_models[horizon][group]
                future = pd.DataFrame({"ds": [row["date"] + pd.Timedelta(days=horizon)]})
                p = prophet_model.predict(future).iloc[0]

                yhat = weight * p["yhat"] + (1 - weight) * lgb_preds[i]
                rows.append(
                    {
                        "priority_group": group,
                        "horizon": horizon,
                        "yhat": max(yhat, 0.0),
                        "yhat_lower": max(p["yhat_lower"], 0.0),
                        "yhat_upper": max(p["yhat_upper"], 0.0),
                    }
                )

        return pd.DataFrame(rows)
