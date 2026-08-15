from __future__ import annotations

import mlflow.pyfunc
import numpy as np
import pandas as pd
import shap


def top_k_shap(shap_row: np.ndarray, feature_names: list[str], k: int = 5) -> list[dict]:
    order = np.argsort(-np.abs(shap_row))[:k]
    return [{"feature": feature_names[i], "shap_value": float(shap_row[i])} for i in order]


class BreachRiskModel(mlflow.pyfunc.PythonModel):
    """Bundles the LightGBM classifier, its post-hoc isotonic calibrator, and a
    SHAP explainer over the raw model. `predict` returns, per row, the
    calibrated breach probability and its top-5 SHAP contributors — SHAP runs
    against the *raw* LightGBM model (calibration only rescales the output, it
    doesn't change which features drove the prediction)."""

    def __init__(self, lgb_model, calibrator, feature_columns: list[str], categorical_columns: list[str]):
        self.lgb_model = lgb_model
        self.calibrator = calibrator
        self.feature_columns = feature_columns
        self.categorical_columns = categorical_columns
        self._explainer = None

    def _prepare(self, model_input: pd.DataFrame) -> pd.DataFrame:
        x = model_input[self.feature_columns].copy()
        for col in self.categorical_columns:
            x[col] = x[col].astype("category")
        return x

    def _explainer_(self, x: pd.DataFrame) -> shap.TreeExplainer:
        if self._explainer is None:
            self._explainer = shap.TreeExplainer(self.lgb_model)
        return self._explainer

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        x = self._prepare(model_input)

        raw_prob = self.lgb_model.predict_proba(x)[:, 1]
        calibrated_prob = self.calibrator.predict(raw_prob)

        shap_values = self._explainer_(x).shap_values(x)
        # Some shap/LightGBM version combos return a list [class0, class1]
        # instead of a single (n_samples, n_features) array for binary
        # classifiers — normalize to the positive class either way.
        if isinstance(shap_values, list):
            shap_values = shap_values[1]

        top5 = [top_k_shap(shap_values[i], self.feature_columns) for i in range(len(x))]

        return pd.DataFrame(
            {
                "breach_probability": calibrated_prob,
                "shap_top5": top5,
            }
        )
