import pandas as pd
import pytest

from external_event.features import (
    MONITOR_FEATURE_COLUMNS,
    FEATURE_COLUMNS,
    to_daily_frame,
)


def _alert(date: str, source: str, **over) -> dict:
    row = {
        "date": date,
        "source": source,
        "total_incidents": 20,
        "unique_entities": 5,
        "incidents_per_entity": 4.0,
        "critical_share": 0.3,
        "manual_open_share": 0.2,
    }
    row.update(over)
    return row


def _monitor(date: str, source: str, **over) -> dict:
    row = {
        "date": date,
        "source": source,
        "total_signals": 20,
        "unique_entities": 5,
        "firing_count": 12,
        "cleared_count": 8,
        "p1_share": 0.1,
        "critical_share": 0.3,
    }
    row.update(over)
    return row


def test_collapses_multiple_sources_into_one_row_per_date():
    alert = pd.DataFrame(
        [
            _alert("2026-01-01", "itsm", total_incidents=20, unique_entities=5, critical_share=0.3),
            _alert(
                "2026-01-01", "service_now", total_incidents=10, unique_entities=3, critical_share=0.5
            ),
        ]
    )

    result = to_daily_frame(alert)

    assert len(result) == 1
    row = result.iloc[0]
    assert row["alert_total_incidents"] == 30
    assert row["alert_unique_entities"] == 8
    assert row["alert_critical_share"] == pytest.approx(0.4)  # media de 0.3 e 0.5
    # recomputado das somas, nao a media das razoes por source
    assert row["alert_incidents_per_entity"] == pytest.approx(30 / 8)


def test_monitor_columns_are_zero_when_no_origin_observes_conditions():
    """Most tenants have no monitor origin at all. Zero signals is what was
    measured on such a day, so the detector still has a full row to train on."""
    alert = pd.DataFrame([_alert("2026-01-01", "itsm")])

    result = to_daily_frame(alert, pd.DataFrame())

    assert set(FEATURE_COLUMNS).issubset(result.columns)
    for column in MONITOR_FEATURE_COLUMNS:
        assert result.iloc[0][column] == 0.0


def test_monitor_widens_the_day_when_it_exists():
    alert = pd.DataFrame([_alert("2026-01-01", "itsm"), _alert("2026-01-02", "itsm")])
    monitor = pd.DataFrame([_monitor("2026-01-01", "zabbix", total_signals=30, unique_entities=6)])

    result = to_daily_frame(alert, monitor).sort_values("date").reset_index(drop=True)

    assert result.iloc[0]["monitor_total_signals"] == 30
    assert result.iloc[0]["monitor_signals_per_entity"] == pytest.approx(30 / 6)
    # o dia sem sinal nenhum nao vira NaN
    assert result.iloc[1]["monitor_total_signals"] == 0.0


def test_output_has_expected_columns_and_is_sorted_by_date():
    alert = pd.DataFrame([_alert("2026-01-03", "itsm"), _alert("2026-01-01", "itsm")])

    result = to_daily_frame(alert)

    assert set(FEATURE_COLUMNS).issubset(result.columns)
    assert list(result["date"]) == sorted(result["date"])
