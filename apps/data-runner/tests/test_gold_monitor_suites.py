from datetime import datetime

import pandas as pd

from suites.gold_monitor import register_gold_monitor_signal_counts


def _load(sqlite_engine, table, rows):
    engine, _ = sqlite_engine
    pd.DataFrame(rows).to_sql(table, engine, index=False, if_exists="replace")


def test_gold_monitor_signal_counts_passes_on_clean_snapshot(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "gold_monitor_signal_counts",
        [
            {
                "tenant_id": "locaweb",
                "entity_id": "host-0",
                "window_start": datetime(2026, 1, 1),
                "window_minutes": 15,
                "signal_count": 3,
            }
        ],
    )

    result = register_gold_monitor_signal_counts(gx_context).run()

    assert result.success is True


def test_gold_monitor_signal_counts_fails_on_invalid_window_minutes(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "gold_monitor_signal_counts",
        [
            {
                "tenant_id": "locaweb",
                "entity_id": "host-0",
                "window_start": datetime(2026, 1, 1),
                "window_minutes": 5,
                "signal_count": 3,
            }
        ],
    )

    result = register_gold_monitor_signal_counts(gx_context).run()

    assert result.success is False
