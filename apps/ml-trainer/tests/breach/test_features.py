import numpy as np
import pandas as pd

from breach.features import (
    FEATURE_COLUMNS,
    TARGET_COLUMN,
    add_group_load_feature,
    add_historical_group_severity_features,
    add_ic_window_features,
    add_p4_precursor_features,
    add_recategorization_history_feature,
    build_feature_frame,
    eligibility_filter,
)


def test_eligibility_filter_drops_p4_p5_parent_and_no_intervention():
    df = pd.DataFrame(
        {
            "severity": [1, 4, 2, 3],
            "has_parent_incident": [0, 0, 1, 0],
            "status": ["closed", "closed", "closed", "no_intervention"],
        }
    )

    result = eligibility_filter(df)

    assert len(result) == 1
    assert result.iloc[0]["severity"] == 1


def test_p4_precursor_only_counts_sequences_ending_before_and_within_window():
    incidents = pd.DataFrame(
        {
            "event_id": ["e1", "e2"],
            "entity_id": ["ic1", "ic3"],
            "opened_at": [pd.Timestamp("2025-06-10 12:00:00"), pd.Timestamp("2025-06-10 12:00:00")],
        }
    )
    p4_sequences = pd.DataFrame(
        {
            "entity_id": ["ic1", "ic1", "ic2"],
            "sequence_end": [
                pd.Timestamp("2025-06-10 10:00:00"),  # 2h before — within 24h window
                pd.Timestamp("2025-06-09 05:00:00"),  # ~31h before — outside window
                pd.Timestamp("2025-06-10 11:00:00"),  # different IC entirely
            ],
            "sequence_length": [3, 10, 5],
        }
    )

    result = add_p4_precursor_features(incidents, p4_sequences, window_hours=24)

    e1 = result.set_index("event_id").loc["e1"]
    e2 = result.set_index("event_id").loc["e2"]
    assert e1["p4_precursor_length"] == 3
    assert e1["p4_precursor_present"] == 1
    assert e2["p4_precursor_length"] == 0
    assert e2["p4_precursor_present"] == 0


def test_ic_window_feature_uses_prior_bucket_not_own_bucket():
    incidents = pd.DataFrame(
        {
            "event_id": ["e1"],
            "entity_id": ["ic1"],
            "opened_at": [pd.Timestamp("2025-06-10 12:30:00")],  # own 1h bucket = 12:00
        }
    )
    ic_windows = pd.DataFrame(
        {
            "entity_id": ["ic1", "ic1"],
            "window_hours": [1, 1],
            "window_start": [pd.Timestamp("2025-06-10 11:00:00"), pd.Timestamp("2025-06-10 12:00:00")],
            "no_intervention_count": [2, 99],  # 99 is the incident's own bucket — must be ignored
        }
    )

    result = add_ic_window_features(incidents, ic_windows)

    assert result.iloc[0]["no_intervention_count_1h"] == 2


def test_group_load_feature_uses_prior_bucket_not_own_bucket():
    incidents = pd.DataFrame(
        {
            "event_id": ["e1"],
            "assignment_group": ["Team14"],
            "opened_at": [pd.Timestamp("2025-06-10 12:30:00")],
        }
    )
    group_load = pd.DataFrame(
        {
            "assignment_group": ["Team14", "Team14"],
            "window_start": [pd.Timestamp("2025-06-10 11:00:00"), pd.Timestamp("2025-06-10 12:00:00")],
            "incidents_opened": [7, 999],
        }
    )

    result = add_group_load_feature(incidents, group_load)

    assert result.iloc[0]["group_load_1h"] == 7


def test_historical_group_severity_features_exclude_own_row():
    incidents = pd.DataFrame(
        {
            "event_id": ["e1", "e2", "e3"],
            "assignment_group": ["Team14", "Team14", "Team14"],
            "severity": [2, 2, 2],
            "opened_at": pd.to_datetime(["2025-06-10 08:00", "2025-06-10 09:00", "2025-06-10 10:00"]),
            "duration_seconds": [7200, 14400, 3600],  # ratios: 0.5, 1.0, 0.25 (ola=14400)
            "ola_limit_seconds": [14400, 14400, 14400],
        }
    )

    result = add_historical_group_severity_features(incidents).set_index("event_id")

    assert pd.isna(result.loc["e1", "group_severity_historical_ola_ratio"])
    assert result.loc["e2", "group_severity_historical_ola_ratio"] == 0.5
    assert result.loc["e3", "group_severity_historical_ola_ratio"] == np.mean([0.5, 1.0])
    assert result.loc["e2", "group_severity_historical_over_25pct_rate"] == 1.0  # e1 was > 25%
    # Own outcome must never leak into the model's feature set.
    assert "duration_ratio_of_ola" not in result.columns
    assert "over_25pct_ola" not in result.columns


def test_recategorization_feature_counts_only_prior_transitions():
    incidents = pd.DataFrame(
        {
            "event_id": ["e1", "e2"],
            "ticket_number": ["INC1", "INC1"],
            "received_at": [pd.Timestamp("2025-06-10 08:00:00"), pd.Timestamp("2025-06-10 10:00:00")],
        }
    )
    priority_changes = pd.DataFrame(
        {
            "ticket_number": ["INC1", "INC1"],
            "received_at": [
                pd.Timestamp("2025-06-10 09:00:00"),  # between e1 and e2 — only e2 sees it
                pd.Timestamp("2025-06-10 11:00:00"),  # after both — neither sees it
            ],
            "severity_from": [3, 2],
            "severity_to": [2, 1],
        }
    )

    result = add_recategorization_history_feature(incidents, priority_changes).set_index("event_id")

    assert result.loc["e1", "recategorization_count"] == 0
    assert result.loc["e1", "was_recategorized"] == 0
    assert result.loc["e2", "recategorization_count"] == 1
    assert result.loc["e2", "was_recategorized"] == 1


def test_recategorization_feature_incident_with_no_transition_at_all():
    incidents = pd.DataFrame(
        {
            "event_id": ["e1"],
            "ticket_number": ["INC1"],
            "received_at": [pd.Timestamp("2025-06-10 08:00:00")],
        }
    )
    priority_changes = pd.DataFrame(columns=["ticket_number", "received_at", "severity_from", "severity_to"])

    result = add_recategorization_history_feature(incidents, priority_changes)

    assert result.iloc[0]["recategorization_count"] == 0
    assert result.iloc[0]["was_recategorized"] == 0


def test_recategorization_feature_ignores_other_tickets_transitions():
    incidents = pd.DataFrame(
        {
            "event_id": ["e1"],
            "ticket_number": ["INC1"],
            "received_at": [pd.Timestamp("2025-06-10 08:00:00")],
        }
    )
    priority_changes = pd.DataFrame(
        {
            "ticket_number": ["INC2"],
            "received_at": [pd.Timestamp("2025-06-10 07:00:00")],
            "severity_from": [3],
            "severity_to": [2],
        }
    )

    result = add_recategorization_history_feature(incidents, priority_changes)

    assert result.iloc[0]["recategorization_count"] == 0


def test_build_feature_frame_has_no_nulls_and_no_leaky_columns():
    n = 40
    dates = pd.date_range("2025-01-01", periods=n, freq="6h")
    incidents = pd.DataFrame(
        {
            "event_id": [f"e{i}" for i in range(n)],
            "entity_id": [f"ic{i % 3}" for i in range(n)],
            "ticket_number": [f"INC{i}" for i in range(n)],
            "received_at": dates,
            "opened_at": dates,
            "assignment_group": ["Team14" if i % 2 == 0 else "TeamX" for i in range(n)],
            "opened_by": ["Manual" if i % 5 == 0 else "Monitoramento" for i in range(n)],
            "has_parent_incident": [0] * n,
            "status": ["Encerrado"] * n,
            "severity": [1 + (i % 3) for i in range(n)],
            "duration_seconds": [3600 + i * 60 for i in range(n)],
            "ola_limit_seconds": [14400] * n,
            "kpi_breached": [i % 7 == 0 for i in range(n)],
        }
    )
    p4_sequences = pd.DataFrame(columns=["entity_id", "sequence_start", "sequence_end", "sequence_length"])
    ic_windows = pd.DataFrame(columns=["entity_id", "window_hours", "window_start", "no_intervention_count"])
    group_load = pd.DataFrame(columns=["assignment_group", "window_start", "incidents_opened"])
    priority_changes = pd.DataFrame(columns=["ticket_number", "received_at", "severity_from", "severity_to"])

    frame = build_feature_frame(incidents, p4_sequences, ic_windows, group_load, priority_changes)

    assert not frame.empty
    assert not frame[[c for c in FEATURE_COLUMNS if c != "assignment_group"]].isna().any().any()
    assert not frame[TARGET_COLUMN].isna().any()
    assert "duration_seconds" not in FEATURE_COLUMNS
    assert "ola_limit_seconds" not in FEATURE_COLUMNS
