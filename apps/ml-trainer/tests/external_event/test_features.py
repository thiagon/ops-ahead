import pandas as pd
import pytest

from src.external_event.features import FEATURE_COLUMNS, to_daily_frame


def test_collapses_multiple_sources_into_one_row_per_date():
    daily = pd.DataFrame(
        [
            {
                "date": "2026-01-01",
                "source": "itsm",
                "total_incidents": 20,
                "p1_share": 0.1,
                "manual_open_share": 0.15,
                "sem_intervencao_share": 0.6,
                "unique_entities": 5,
            },
            {
                "date": "2026-01-01",
                "source": "alertmanager",
                "total_incidents": 10,
                "p1_share": 0.2,
                "manual_open_share": 0.05,
                "sem_intervencao_share": 0.4,
                "unique_entities": 3,
            },
        ]
    )

    result = to_daily_frame(daily)

    assert len(result) == 1
    row = result.iloc[0]
    assert row["total_incidents"] == 30
    assert row["unique_entities"] == 8
    assert row["p1_share"] == pytest.approx(0.15)  # mean of 0.1 and 0.2
    assert row["manual_open_share"] == pytest.approx(0.1)  # mean of 0.15 and 0.05


def test_output_has_expected_columns_and_is_sorted_by_date():
    daily = pd.DataFrame(
        [
            {
                "date": "2026-01-03",
                "source": "itsm",
                "total_incidents": 5,
                "p1_share": 0.0,
                "manual_open_share": 0.0,
                "sem_intervencao_share": 0.0,
                "unique_entities": 1,
            },
            {
                "date": "2026-01-01",
                "source": "itsm",
                "total_incidents": 5,
                "p1_share": 0.0,
                "manual_open_share": 0.0,
                "sem_intervencao_share": 0.0,
                "unique_entities": 1,
            },
        ]
    )

    result = to_daily_frame(daily)

    assert set(FEATURE_COLUMNS).issubset(result.columns)
    assert list(result["date"]) == sorted(result["date"])
