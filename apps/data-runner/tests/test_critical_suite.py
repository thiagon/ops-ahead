from datetime import datetime, timedelta

import pandas as pd

from src.suites.critical import register


def _rows(n=5):
    base = datetime(2026, 1, 1, 10, 0, 0)
    return [
        {
            "event_id": f"evt-{i}",
            "opened_at": base - timedelta(minutes=5),
            "received_at": base,
            "entity_id": f"host-{i % 2}",
            "severity": (i % 5) + 1,
        }
        for i in range(n)
    ]


def _load(sqlite_engine, rows):
    engine, _ = sqlite_engine
    pd.DataFrame(rows).to_sql("incidents_received", engine, index=False, if_exists="replace")


def test_critical_suite_passes_on_clean_snapshot(sqlite_engine, gx_context):
    _load(sqlite_engine, _rows())

    result = register(gx_context).run()

    assert result.success is True


def test_critical_suite_fails_on_duplicate_event_id(sqlite_engine, gx_context):
    rows = _rows()
    rows[1]["event_id"] = rows[0]["event_id"]
    _load(sqlite_engine, rows)

    result = register(gx_context).run()

    assert result.success is False


def test_critical_suite_fails_on_severity_out_of_range(sqlite_engine, gx_context):
    rows = _rows()
    rows[0]["severity"] = 99
    _load(sqlite_engine, rows)

    result = register(gx_context).run()

    assert result.success is False


def test_critical_suite_fails_when_opened_at_after_received_at(sqlite_engine, gx_context):
    rows = _rows()
    rows[0]["opened_at"] = rows[0]["received_at"] + timedelta(hours=1)
    _load(sqlite_engine, rows)

    result = register(gx_context).run()

    assert result.success is False


def test_critical_suite_fails_on_null_entity_id(sqlite_engine, gx_context):
    rows = _rows()
    rows[0]["entity_id"] = None
    _load(sqlite_engine, rows)

    result = register(gx_context).run()

    assert result.success is False
