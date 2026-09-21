from datetime import datetime

import pandas as pd

from suites.marts import register_incidents_by_ic, register_kpi_monthly_state


def _load(sqlite_engine, table, rows):
    engine, _ = sqlite_engine
    pd.DataFrame(rows).to_sql(table, engine, index=False, if_exists="replace")


def test_incidents_by_ic_passes_on_clean_snapshot(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "incidents_by_ic",
        [
            {
                "tenant_id": "locaweb",
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
                "tenant_id": "locaweb",
                "entity_id": "host-0",
                "window_start": datetime(2026, 1, 1),
                "window_hours": 3,
                "incident_count": 3,
            }
        ],
    )

    result = register_incidents_by_ic(gx_context).run()

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
