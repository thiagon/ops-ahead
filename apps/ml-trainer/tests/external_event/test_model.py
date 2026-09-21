import pandas as pd

from external_event.model import ExternalEventModel
from external_event.train import fit_isolation_forest


def _daily_frame_with_one_spike(n_normal: int = 40) -> pd.DataFrame:
    """Alert-shaped days with one obvious outlier. No monitor origin, so those
    columns sit at zero — the shape most tenants actually have."""
    rows = [
        {
            "alert_total_incidents": 20 + (i % 3),
            "alert_incidents_per_entity": (20 + (i % 3)) / 5,
            "alert_unique_entities": 5,
            "alert_critical_share": 0.3,
            "alert_manual_open_share": 0.2,
            "monitor_total_signals": 0.0,
            "monitor_signals_per_entity": 0.0,
            "monitor_unique_entities": 0.0,
            "monitor_p1_share": 0.0,
            "monitor_critical_share": 0.0,
            "monitor_cleared_share": 0.0,
        }
        for i in range(n_normal)
    ]
    rows.append(
        {
            "alert_total_incidents": 500,  # obvious spike
            "alert_incidents_per_entity": 500 / 40,
            "alert_unique_entities": 40,
            "alert_critical_share": 0.95,
            "alert_manual_open_share": 0.9,
            "monitor_total_signals": 0.0,
            "monitor_signals_per_entity": 0.0,
            "monitor_unique_entities": 0.0,
            "monitor_p1_share": 0.0,
            "monitor_critical_share": 0.0,
            "monitor_cleared_share": 0.0,
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
