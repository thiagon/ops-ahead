from datetime import datetime

import pandas as pd

from suites.marts import (
    register_daily_anomaly_features,
    register_incidents_by_ic,
    register_kpi_monthly_state,
)


def _load(sqlite_engine, table, rows):
    engine, _ = sqlite_engine
    pd.DataFrame(rows).to_sql(table, engine, index=False, if_exists="replace")


def test_incidents_by_ic_passes_on_clean_snapshot(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "incidents_by_ic",
        [
            {
                "entity_id": "host-0",
                "window_start": datetime(2026, 1, 1),
                "window_hours": 24,
                "incident_count": 3,
            }
        ],
    )

    result = register_incidents_by_ic(gx_context).run()

    assert result.success is True


def test_incidents_by_ic_fails_on_invalid_window_hours(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "incidents_by_ic",
        [
            {
                "entity_id": "host-0",
                "window_start": datetime(2026, 1, 1),
                "window_hours": 3,
                "incident_count": 3,
            }
        ],
    )

    result = register_incidents_by_ic(gx_context).run()

    assert result.success is False


def test_daily_anomaly_features_passes_on_clean_snapshot(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "daily_anomaly_features",
        [
            {
                "date": datetime(2026, 1, 1),
                "source": "itsm-locaweb",
                "total_incidents": 42,
                "p1_share": 0.1,
                "breach_rate": 0.05,
                "manual_open_share": 0.14,
                "no_intervention_share": 0.65,
            }
        ],
    )

    result = register_daily_anomaly_features(gx_context).run()

    assert result.success is True


def test_daily_anomaly_features_fails_on_breach_rate_out_of_range(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "daily_anomaly_features",
        [
            {
                "date": datetime(2026, 1, 1),
                "source": "itsm-locaweb",
                "total_incidents": 42,
                "p1_share": 0.1,
                "breach_rate": 1.5,
                "manual_open_share": 0.14,
                "no_intervention_share": 0.65,
            }
        ],
    )

    result = register_daily_anomaly_features(gx_context).run()

    assert result.success is False


def test_daily_anomaly_features_fails_on_manual_open_share_out_of_range(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "daily_anomaly_features",
        [
            {
                "date": datetime(2026, 1, 1),
                "source": "itsm-locaweb",
                "total_incidents": 42,
                "p1_share": 0.1,
                "breach_rate": 0.05,
                "manual_open_share": 1.2,
                "no_intervention_share": 0.65,
            }
        ],
    )

    result = register_daily_anomaly_features(gx_context).run()

    assert result.success is False


def test_kpi_monthly_state_passes_on_clean_snapshot(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "kpi_monthly_state",
        [
            {
                "month": datetime(2026, 1, 1),
                "severity": 2,
                "breach_rate": 0.2,
                "total": 100,
            }
        ],
    )

    result = register_kpi_monthly_state(gx_context).run()

    assert result.success is True


def test_kpi_monthly_state_fails_on_severity_outside_measured_range(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "kpi_monthly_state",
        [
            {
                "month": datetime(2026, 1, 1),
                "severity": 4,
                "breach_rate": 0.2,
                "total": 100,
            }
        ],
    )

    result = register_kpi_monthly_state(gx_context).run()

    assert result.success is False
