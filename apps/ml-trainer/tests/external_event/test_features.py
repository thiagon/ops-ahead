import pandas as pd
import pytest

from external_event.features import FEATURE_COLUMNS, to_daily_frame


def test_collapses_multiple_sources_into_one_row_per_date():
    daily = pd.DataFrame(
        [
            {
                "date": "2026-01-01",
                "source": "itsm",
                "total_signals": 20,
                "firing_count": 12,
                "cleared_count": 8,
                "p1_share": 0.1,
                "critical_share": 0.3,
                "unique_entities": 5,
            },
            {
                "date": "2026-01-01",
                "source": "alertmanager",
                "total_signals": 10,
                "firing_count": 6,
                "cleared_count": 4,
                "p1_share": 0.2,
                "critical_share": 0.5,
                "unique_entities": 3,
            },
        ]
    )

    result = to_daily_frame(daily)

    assert len(result) == 1
    row = result.iloc[0]
    assert row["total_signals"] == 30
    assert row["unique_entities"] == 8
    assert row["p1_share"] == pytest.approx(0.15)  # mean of 0.1 and 0.2
    assert row["critical_share"] == pytest.approx(0.4)  # mean of 0.3 and 0.5
    assert row["signals_per_entity"] == pytest.approx(30 / 8)  # recomputed from summed counts
    assert row["cleared_share"] == pytest.approx(12 / 30)  # (8+4)/(20+10), not averaged


def test_output_has_expected_columns_and_is_sorted_by_date():
    daily = pd.DataFrame(
        [
            {
                "date": "2026-01-03",
                "source": "itsm",
                "total_signals": 5,
                "firing_count": 3,
                "cleared_count": 2,
                "p1_share": 0.0,
                "critical_share": 0.0,
                "unique_entities": 1,
            },
            {
                "date": "2026-01-01",
                "source": "itsm",
                "total_signals": 5,
                "firing_count": 3,
                "cleared_count": 2,
                "p1_share": 0.0,
                "critical_share": 0.0,
                "unique_entities": 1,
            },
        ]
    )

    result = to_daily_frame(daily)

    assert set(FEATURE_COLUMNS).issubset(result.columns)
    assert list(result["date"]) == sorted(result["date"])
