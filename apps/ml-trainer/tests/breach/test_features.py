import numpy as np
import pandas as pd

from breach.features import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    abandonment_filter,
    add_calendar_features,
    add_deadline_features,
    add_historical_group_severity_features,
    add_manual_open_flag,
    add_monitor_context_features,
    add_precursor_features,
    add_recategorization_history_feature,
    build_feature_frame,
    closed_filter,
    eligibility_filter,
    noise_filter,
    noise_threshold,
)


def test_manual_open_flag_reads_the_domain_vocabulary():
    """The origin says "Manual"/"Monitoramento"; the translation stage
    resolves it before this ever runs, so a pt-br value here means the
    boundary leaked."""
    df = pd.DataFrame({"reported_by": ["manual", "monitoring", "unknown"]})
    result = add_manual_open_flag(df)
    assert result["is_manual_open"].tolist() == [1, 0, 0]


def test_eligibility_filter_trusts_the_mart_column():
    df = pd.DataFrame({"is_eligible": [True, False, True], "milestone_id": ["a", "b", "c"]})
    result = eligibility_filter(df)
    assert result["milestone_id"].tolist() == ["a", "c"]


def test_closed_filter_drops_incidents_without_a_final_duration():
    df = pd.DataFrame({"final_duration_seconds": [3600, None, 7200]})
    result = closed_filter(df)
    assert len(result) == 2


def test_abandonment_filter_excludes_at_or_above_threshold():
    df = pd.DataFrame({"final_consumed_ratio": [0.5, 10.0, 15.0, 9.999]})
    result = abandonment_filter(df, abandoned_ratio=10.0)
    assert result["final_consumed_ratio"].tolist() == [0.5, 9.999]


def test_noise_threshold_floors_at_60_seconds():
    df = pd.DataFrame({"final_duration_seconds": [10.0] * 100})  # 1st percentile well below 60
    assert noise_threshold(df) == 60.0


def test_noise_filter_drops_below_threshold():
    df = pd.DataFrame({"final_duration_seconds": [10, 60, 3600]})
    result = noise_filter(df, threshold=60.0)
    assert result["final_duration_seconds"].tolist() == [60, 3600]


def test_precursor_features_derive_present_from_length():
    df = pd.DataFrame({"no_intervention_precursor_length": [0, 3, None]})
    result = add_precursor_features(df)
    assert result["p4_precursor_length"].tolist() == [0, 3, 0]
    assert result["p4_precursor_present"].tolist() == [0, 1, 0]


def test_recategorization_feature_derives_from_severity_changes():
    df = pd.DataFrame({"severity_changes": [0, 2, None]})
    result = add_recategorization_history_feature(df)
    assert result["recategorization_count"].tolist() == [0, 2, 0]
    assert result["was_recategorized"].tolist() == [0, 1, 0]


def test_deadline_features_compute_time_remaining_and_acknowledgement():
    df = pd.DataFrame(
        {
            "consumed_ratio_at_milestone": [0.5],
            "due_at": [pd.Timestamp("2025-06-10 14:00:00")],
            "occurred_at": [pd.Timestamp("2025-06-10 12:00:00")],
            "acknowledged_at_at_milestone": [pd.Timestamp("2025-06-10 11:30:00")],
        }
    )
    result = add_deadline_features(df)
    assert result.iloc[0]["consumed_ratio"] == 0.5
    assert result.iloc[0]["time_remaining_seconds"] == 7200.0
    assert result.iloc[0]["was_acknowledged"] == 1


def test_deadline_features_not_acknowledged_when_null():
    df = pd.DataFrame(
        {
            "consumed_ratio_at_milestone": [0.25],
            "due_at": [pd.Timestamp("2025-06-10 14:00:00")],
            "occurred_at": [pd.Timestamp("2025-06-10 10:00:00")],
            "acknowledged_at_at_milestone": [pd.NaT],
        }
    )
    result = add_deadline_features(df)
    assert result.iloc[0]["was_acknowledged"] == 0


def test_calendar_features_read_severity_from_milestone():
    df = pd.DataFrame(
        {
            "severity_at_milestone": [2],
            "opened_at": [pd.Timestamp("2025-06-10 13:00:00")],  # Tuesday
        }
    )
    result = add_calendar_features(df)
    assert result.iloc[0]["severity"] == 2
    assert result.iloc[0]["opened_hour"] == 13
    assert result.iloc[0]["opened_dayofweek"] == 1


def test_monitor_context_uses_nearest_window_strictly_matching_or_before_occurred_at():
    df = pd.DataFrame({"entity_id": ["ic1"], "occurred_at": [pd.Timestamp("2025-06-10 12:30:00")]})
    signal_counts = pd.DataFrame(
        {
            "entity_id": ["ic1", "ic1", "ic1"],
            "window_minutes": [15, 15, 60],
            "window_start": [
                pd.Timestamp("2025-06-10 12:15:00"),
                pd.Timestamp("2025-06-10 12:45:00"),  # after occurred_at — must be ignored
                pd.Timestamp("2025-06-10 12:00:00"),
            ],
            "signal_count": [4, 999, 9],
        }
    )
    auto_resolution_rate = pd.DataFrame({"entity_id": ["ic1"], "auto_resolution_rate": [0.8]})
    severity_escalations = pd.DataFrame(
        {
            "entity_id": ["ic1", "ic1"],
            "date": [pd.Timestamp("2025-06-09"), pd.Timestamp("2025-06-10")],
            "escalation_count": [2, 5],
        }
    )

    result = add_monitor_context_features(df, signal_counts, auto_resolution_rate, severity_escalations)

    assert result.iloc[0]["entity_signal_count_15m"] == 4
    assert result.iloc[0]["entity_signal_count_1h"] == 9
    assert result.iloc[0]["entity_auto_resolution_rate"] == 0.8
    # Same-day (2025-06-10) escalations are still an incomplete bucket —
    # only the strictly-prior day's cumulative count (2) may count.
    assert result.iloc[0]["entity_severity_escalations"] == 2


def test_monitor_context_defaults_missing_entity_to_zero_counts():
    df = pd.DataFrame({"entity_id": ["unknown"], "occurred_at": [pd.Timestamp("2025-06-10 12:00:00")]})
    empty = pd.DataFrame(columns=["entity_id", "window_minutes", "window_start", "signal_count"])
    auto_resolution_rate = pd.DataFrame(columns=["entity_id", "auto_resolution_rate"])
    severity_escalations = pd.DataFrame(columns=["entity_id", "date", "escalation_count"])

    result = add_monitor_context_features(df, empty, auto_resolution_rate, severity_escalations)

    assert result.iloc[0]["entity_signal_count_15m"] == 0
    assert result.iloc[0]["entity_signal_count_1h"] == 0
    assert result.iloc[0]["entity_severity_escalations"] == 0


def test_historical_group_severity_features_exclude_own_row_and_dedupe_by_incident():
    # e1/e1b are the same incident's two marcos — must count once as history.
    incidents = pd.DataFrame(
        {
            "tenant_id": ["locaweb"] * 4,
            "source": ["itsm"] * 4,
            "external_id": ["INC1", "INC1", "INC2", "INC3"],
            "owner": ["Team14", "Team14", "Team14", "Team14"],
            "severity": [2, 2, 2, 2],
            "opened_at": pd.to_datetime(
                ["2025-06-10 08:00", "2025-06-10 08:00", "2025-06-10 09:00", "2025-06-10 10:00"]
            ),
            "final_duration_seconds": [7200, 7200, 14400, 3600],  # ratios: 0.5, 0.5, 1.0, 0.25
            "deadline_seconds": [14400] * 4,
        }
    )

    result = add_historical_group_severity_features(incidents)
    # Both of INC1's marcos survive as distinct rows — dedup only applies to
    # the historical population being computed over, never to the output.
    assert len(result) == 4
    by_incident = result.drop_duplicates(subset="external_id").set_index("external_id")

    assert pd.isna(by_incident.loc["INC1", "group_severity_historical_ola_ratio"])
    assert by_incident.loc["INC2", "group_severity_historical_ola_ratio"] == 0.5
    assert by_incident.loc["INC3", "group_severity_historical_ola_ratio"] == np.mean([0.5, 1.0])
    assert by_incident.loc["INC2", "group_severity_historical_over_25pct_rate"] == 1.0  # INC1 was > 25%
    # Own outcome must never leak into the model's feature set.
    assert "duration_ratio_of_deadline" not in result.columns
    assert "over_25pct_deadline" not in result.columns


def _training_examples(n: int) -> pd.DataFrame:
    dates = pd.date_range("2025-01-01", periods=n, freq="6h")
    return pd.DataFrame(
        {
            "milestone_id": [f"m{i}" for i in range(n)],
            "tenant_id": ["locaweb"] * n,
            "source": ["itsm"] * n,
            "external_id": [f"INC{i}" for i in range(n)],
            "entity_id": [f"ic{i % 3}" for i in range(n)],
            "kind": ["pct_25"] * n,
            "severity_at_milestone": [1 + (i % 3) for i in range(n)],
            "opened_at": dates,
            "acknowledged_at_at_milestone": [pd.NaT] * n,
            "due_at": dates + pd.Timedelta(hours=4),
            "deadline_seconds": [14400] * n,
            "consumed_ratio_at_milestone": [0.25] * n,
            "occurred_at": dates + pd.Timedelta(hours=1),
            "owner": ["Team14" if i % 2 == 0 else "TeamX" for i in range(n)],
            "reported_by": ["manual" if i % 5 == 0 else "monitoring" for i in range(n)],
            "parent_id": [""] * n,
            "resolution_code": [""] * n,
            "status": ["resolved"] * n,
            "severity_changes": [0] * n,
            "is_eligible": [True] * n,
            "group_load": [i % 4 for i in range(n)],
            "no_intervention_count_1h": [0] * n,
            "no_intervention_count_6h": [0] * n,
            "no_intervention_precursor_length": [0] * n,
            "has_breached": [i % 7 == 0 for i in range(n)],
            "final_consumed_ratio": [0.9] * n,
            "final_duration_seconds": [3600 + i * 60 for i in range(n)],
        }
    )


def test_build_feature_frame_has_no_nulls_and_no_leaky_columns():
    examples = _training_examples(40)
    signal_counts = pd.DataFrame(columns=["entity_id", "window_minutes", "window_start", "signal_count"])
    # entity_auto_resolution_rate is a required feature (nullable only at
    # serving time, per ml-model-serving's schema) — every entity the
    # examples reference needs coverage or build_feature_frame's dropna
    # empties the whole frame.
    auto_resolution_rate = pd.DataFrame(
        {"entity_id": ["ic0", "ic1", "ic2"], "auto_resolution_rate": [0.5, 0.6, 0.7]}
    )
    severity_escalations = pd.DataFrame(columns=["entity_id", "date", "escalation_count"])

    frame = build_feature_frame(examples, signal_counts, auto_resolution_rate, severity_escalations)

    assert not frame.empty
    assert not frame[[c for c in FEATURE_COLUMNS if c != "owner"]].isna().any().any()
    assert not frame[TARGET_COLUMN].isna().any()
    assert "final_duration_seconds" not in FEATURE_COLUMNS
    assert "final_consumed_ratio" not in FEATURE_COLUMNS
    assert "is_eligible" not in FEATURE_COLUMNS


def test_build_feature_frame_drops_abandoned_and_open_incidents():
    examples = _training_examples(10)
    examples.loc[0, "final_consumed_ratio"] = 10.0  # abandoned — must be excluded
    examples.loc[1, "final_duration_seconds"] = None  # still open — must be excluded
    signal_counts = pd.DataFrame(columns=["entity_id", "window_minutes", "window_start", "signal_count"])
    auto_resolution_rate = pd.DataFrame(
        {"entity_id": ["ic0", "ic1", "ic2"], "auto_resolution_rate": [0.5, 0.6, 0.7]}
    )
    severity_escalations = pd.DataFrame(columns=["entity_id", "date", "escalation_count"])

    frame = build_feature_frame(examples, signal_counts, auto_resolution_rate, severity_escalations)

    assert "m0" not in frame["milestone_id"].values
    assert "m1" not in frame["milestone_id"].values


def test_an_incident_crossing_three_marcos_yields_three_distinct_examples():
    base = _training_examples(1).iloc[0]
    rows = []
    for kind, hours_after in (("pct_25", 1), ("pct_50", 2), ("pct_75", 3)):
        row = base.copy()
        row["milestone_id"] = f"m-{kind}"
        row["kind"] = kind
        row["occurred_at"] = base["opened_at"] + pd.Timedelta(hours=hours_after)
        rows.append(row)
    # An earlier, unrelated incident in the same owner+severity group — with
    # no history at all, group_severity_historical_ola_ratio would be NaN
    # for every one of the three marcos above and the dropna would wipe out
    # this incident's rows too, which is not what this test is about.
    earlier = base.copy()
    earlier["milestone_id"] = "m-earlier"
    earlier["external_id"] = "INC-earlier"
    earlier["opened_at"] = base["opened_at"] - pd.Timedelta(days=1)
    earlier["occurred_at"] = earlier["opened_at"] + pd.Timedelta(hours=1)
    rows.append(earlier)
    examples = pd.DataFrame(rows)
    signal_counts = pd.DataFrame(columns=["entity_id", "window_minutes", "window_start", "signal_count"])
    auto_resolution_rate = pd.DataFrame({"entity_id": [base["entity_id"]], "auto_resolution_rate": [0.5]})
    severity_escalations = pd.DataFrame(columns=["entity_id", "date", "escalation_count"])

    frame = build_feature_frame(examples, signal_counts, auto_resolution_rate, severity_escalations)

    marco_rows = frame.loc[frame["external_id"] == base["external_id"]]
    assert len(marco_rows) == 3
    assert set(marco_rows["milestone_id"]) == {"m-pct_25", "m-pct_50", "m-pct_75"}
