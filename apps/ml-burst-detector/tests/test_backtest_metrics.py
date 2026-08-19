import math

import pandas as pd

from backtest_metrics import (
    Alert,
    chronological_split,
    evaluate_alerts,
    group_p1_p2_by_entity,
    precision_recall_curve,
)

T0 = pd.Timestamp("2026-01-01T00:00:00")


def _ts(seconds: float) -> pd.Timestamp:
    return T0 + pd.Timedelta(seconds=seconds)


class TestEvaluateAlertsLeadTimeFloor:
    def test_incident_within_floor_is_not_a_true_positive(self):
        # 500s < the 900s (15min) N1 action floor — the exact bias
        # docs/insights (Technical Notes) describes: an alert riding the same
        # burst as the P1/P2 shouldn't count as "predicting" it.
        alerts = [Alert("IC1", T0, "spike", "15m")]
        p1_p2_by_entity = {"IC1": [_ts(500)]}

        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert metrics["true_positives"] == 0
        assert metrics["precision"] == 0.0
        assert metrics["recall"] == 0.0

    def test_incident_past_floor_and_within_window_is_a_true_positive(self):
        alerts = [Alert("IC1", T0, "spike", "15m")]
        p1_p2_by_entity = {"IC1": [_ts(1200)]}

        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert metrics["true_positives"] == 1
        assert metrics["precision"] == 1.0
        assert metrics["recall"] == 1.0
        assert metrics["median_lead_time_seconds"] == 1200

    def test_incident_past_the_outer_window_does_not_count(self):
        alerts = [Alert("IC1", T0, "spike", "15m")]
        p1_p2_by_entity = {"IC1": [_ts(4000)]}  # past the 3600s outer window

        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert metrics["true_positives"] == 0

    def test_known_lead_time_reproduces_expected_median(self):
        # Synthetic ground truth: three alerts, each with a hand-picked,
        # known lead time — the median of [1000, 2000, 3000] is 2000.
        alerts = [
            Alert("IC1", T0, "spike", "15m"),
            Alert("IC2", T0, "spike", "15m"),
            Alert("IC3", T0, "spike", "15m"),
        ]
        p1_p2_by_entity = {"IC1": [_ts(1000)], "IC2": [_ts(2000)], "IC3": [_ts(3000)]}

        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert metrics["median_lead_time_seconds"] == 2000


class TestEvaluateAlertsRecall:
    def test_recall_counts_p1_p2_covered_by_any_alert(self):
        alerts = [Alert("IC1", T0, "spike", "15m")]
        p1_p2_by_entity = {"IC1": [_ts(1000), _ts(2_000_000)]}  # one covered, one far outside window

        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert metrics["total_p1_p2"] == 2
        assert metrics["covered_p1_p2"] == 1
        assert metrics["recall"] == 0.5

    def test_recall_is_nan_with_no_p1_p2_at_all(self):
        metrics = evaluate_alerts([], {}, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert math.isnan(metrics["recall"])

    def test_uncovered_p1_p2_does_not_inflate_recall(self):
        alerts: list[Alert] = []
        p1_p2_by_entity = {"IC1": [_ts(1000)]}

        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert metrics["recall"] == 0.0


class TestEvaluateAlertsByType:
    def test_breaks_down_precision_by_alert_type(self):
        alerts = [
            Alert("IC1", T0, "spike", "15m"),
            Alert("IC2", T0, "regime_change", "1h"),
        ]
        p1_p2_by_entity = {"IC1": [_ts(1200)]}  # only IC1's spike is a hit

        metrics = evaluate_alerts(alerts, p1_p2_by_entity, min_lead_time_seconds=900, lead_time_window_seconds=3600)

        assert metrics["by_alert_type"]["spike"]["precision"] == 1.0
        assert metrics["by_alert_type"]["regime_change"]["precision"] == 0.0
        assert metrics["by_alert_type"]["spike"]["total_alerts"] == 1
        assert metrics["by_alert_type"]["regime_change"]["total_alerts"] == 1


class TestChronologicalSplit:
    def test_splits_by_time_not_by_row_order(self):
        df = pd.DataFrame({"t": [T0 + pd.Timedelta(days=i) for i in range(10)][::-1]})  # reverse order

        calibration, evaluation = chronological_split(df, "t", calibration_fraction=0.7)

        assert len(calibration) == 7
        assert len(evaluation) == 3
        assert calibration["t"].max() < evaluation["t"].min()


class TestPrecisionRecallCurve:
    def test_one_point_per_threshold_in_order(self):
        def raise_for_threshold(threshold):
            return [Alert("IC1", T0, "spike", "15m")] if threshold <= 3.0 else []

        curve = precision_recall_curve(
            [2.0, 3.0, 4.0],
            raise_for_threshold,
            {"IC1": [_ts(1200)]},
            min_lead_time_seconds=900,
            lead_time_window_seconds=3600,
        )

        assert [point["z_score_threshold"] for point in curve] == [2.0, 3.0, 4.0]
        assert curve[0]["total_alerts"] == 1
        assert curve[2]["total_alerts"] == 0


class TestGroupP1P2ByEntity:
    def test_groups_and_sorts_by_time(self):
        df = pd.DataFrame(
            {
                "entity_id": ["IC1", "IC1", "IC2"],
                "opened_at": [_ts(200), _ts(100), _ts(50)],
            }
        )

        grouped = group_p1_p2_by_entity(df, "entity_id", "opened_at")

        assert grouped["IC1"] == [_ts(100), _ts(200)]
        assert grouped["IC2"] == [_ts(50)]
