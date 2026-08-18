import pandas as pd

from external_event.model import ExternalEventModel
from external_event.train import fit_isolation_forest


def _daily_frame_with_one_spike(n_normal: int = 40) -> pd.DataFrame:
    rows = [
        {
            "total_incidents": 20 + (i % 3),
            "p1_share": 0.1,
            "manual_open_share": 0.15,
            "unique_entities": 5,
            "no_intervention_share": 0.6,
        }
        for i in range(n_normal)
    ]
    rows.append(
        {
            "total_incidents": 500,  # obvious spike
            "p1_share": 0.9,
            "manual_open_share": 0.02,
            "unique_entities": 40,
            "no_intervention_share": 0.05,
        }
    )
    return pd.DataFrame(rows)


class TestExternalEventModel:
    def test_predict_output_shape_and_columns(self):
        frame = _daily_frame_with_one_spike()
        model = fit_isolation_forest(frame, contamination=0.05)
        bundled = ExternalEventModel(model)

        result = bundled.predict(None, frame)

        assert list(result.columns) == ["is_external_event", "anomaly_score"]
        assert len(result) == len(frame)
        assert set(result["is_external_event"].unique()).issubset({0, 1})

    def test_the_obvious_spike_is_flagged(self):
        frame = _daily_frame_with_one_spike()
        model = fit_isolation_forest(frame, contamination=0.05)
        bundled = ExternalEventModel(model)

        result = bundled.predict(None, frame)

        assert result.iloc[-1]["is_external_event"] == 1

    def test_normal_days_are_not_flagged_en_masse(self):
        frame = _daily_frame_with_one_spike()
        model = fit_isolation_forest(frame, contamination=0.05)
        bundled = ExternalEventModel(model)

        result = bundled.predict(None, frame)

        normal_days_flagged = result.iloc[:-1]["is_external_event"].sum()
        assert normal_days_flagged <= 2  # small tolerance, never "most days"

    def test_anomaly_score_is_higher_for_the_spike(self):
        frame = _daily_frame_with_one_spike()
        model = fit_isolation_forest(frame, contamination=0.05)
        bundled = ExternalEventModel(model)

        result = bundled.predict(None, frame)

        assert result.iloc[-1]["anomaly_score"] > result.iloc[:-1]["anomaly_score"].median()
