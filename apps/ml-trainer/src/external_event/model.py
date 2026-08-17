from __future__ import annotations

import mlflow.pyfunc
import pandas as pd

from src.external_event.features import FEATURE_COLUMNS


class ExternalEventModel(mlflow.pyfunc.PythonModel):
    """Bundles a fitted `IsolationForest`. `predict()` returns, per input
    row, the day/window marking that `detect_external_event` (Sprint 2 §3.3)
    and the other models' training filter both consume: `is_external_event`
    (1 = anomalous) and `anomaly_score` (higher = more anomalous — the
    negative of sklearn's `decision_function`, which scores anomalies
    negative and normal points positive)."""

    def __init__(self, isolation_forest):
        self.isolation_forest = isolation_forest

    def predict(self, context, model_input: pd.DataFrame, params=None) -> pd.DataFrame:
        x = model_input[FEATURE_COLUMNS]
        raw_prediction = self.isolation_forest.predict(x)  # 1 normal, -1 anomaly
        raw_score = self.isolation_forest.decision_function(x)  # higher = more normal

        return pd.DataFrame(
            {
                "is_external_event": (raw_prediction == -1).astype(int),
                "anomaly_score": -raw_score,
            }
        )
