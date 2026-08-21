import pandas as pd

from suites.silver import register_silver_alert, register_silver_monitor


def _load(sqlite_engine, table, rows):
    engine, _ = sqlite_engine
    pd.DataFrame(rows).to_sql(table, engine, index=False, if_exists="replace")


def test_silver_alert_passes_when_each_occurrence_has_one_row(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "silver_alert",
        [
            {"tenant_id": "locaweb", "source": "itsm", "external_id": "INC1"},
            {"tenant_id": "locaweb", "source": "itsm", "external_id": "INC2"},
        ],
    )

    result = register_silver_alert(gx_context).run()

    assert result.success is True


def test_silver_alert_fails_when_dedup_did_not_collapse_a_key(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "silver_alert",
        [
            {"tenant_id": "locaweb", "source": "itsm", "external_id": "INC1"},
            {"tenant_id": "locaweb", "source": "itsm", "external_id": "INC1"},
        ],
    )

    result = register_silver_alert(gx_context).run()

    assert result.success is False


def test_silver_monitor_passes_when_each_condition_has_one_row(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "silver_monitor",
        [
            {"tenant_id": "locaweb", "source": "zabbix", "external_id": "trg-1"},
        ],
    )

    result = register_silver_monitor(gx_context).run()

    assert result.success is True


def test_silver_monitor_fails_when_dedup_did_not_collapse_a_key(sqlite_engine, gx_context):
    _load(
        sqlite_engine,
        "silver_monitor",
        [
            {"tenant_id": "locaweb", "source": "zabbix", "external_id": "trg-1"},
            {"tenant_id": "locaweb", "source": "zabbix", "external_id": "trg-1"},
        ],
    )

    result = register_silver_monitor(gx_context).run()

    assert result.success is False
