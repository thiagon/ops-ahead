import pandas as pd
import pytest

from kpi_projection import data
from settings import Settings


class _FakeClient:
    def __init__(self, rows_by_query):
        self._rows_by_query = rows_by_query
        self.executed = []

    def execute(self, query, *args, **kwargs):
        self.executed.append(query)
        for needle, rows in self._rows_by_query.items():
            if needle in query:
                return rows
        raise AssertionError(f"unexpected query: {query}")


@pytest.fixture
def settings() -> Settings:
    return Settings(clickhouse_url="clickhouse://default:@localhost:9000/default")


def test_fetch_kpi_achievement_reads_gold_alert_kpi_achievement_by_kpi_group(monkeypatch, settings):
    fake = _FakeClient(
        {
            "gold_alert_kpi_achievement": [
                ("locaweb", 2026, pd.Timestamp("2026-08-01"), "p1_p2", 3, 30),
            ],
            "tenant_kpi_targets": [
                ("locaweb", "p1_p2", 30, 100),
            ],
        }
    )
    monkeypatch.setattr(data.Client, "from_url", lambda url: fake)

    achievement = data.fetch_kpi_achievement(settings)
    targets = data.fetch_kpi_targets(settings)

    assert any("gold_alert_kpi_achievement" in q for q in fake.executed)
    assert any("kpi_group" in q for q in fake.executed)
    assert list(achievement["kpi_group"]) == ["p1_p2"]
    assert list(targets["kpi_group"]) == ["p1_p2"]


def test_fetch_kpi_monthly_state_reads_eligibility_by_month_and_severity(monkeypatch, settings):
    # Eligibility signal only — unrelated to the annual breach-count band in
    # gold_alert_kpi_achievement, so main.py still needs both.
    fake = _FakeClient(
        {
            "kpi_monthly_state": [
                (pd.Timestamp("2026-08-01"), 1, "itsm", 10, 9, 1),
            ],
        }
    )
    monkeypatch.setattr(data.Client, "from_url", lambda url: fake)

    kpi_state = data.fetch_kpi_monthly_state(settings)

    assert any("kpi_monthly_state" in q for q in fake.executed)
    assert list(kpi_state["severity"]) == [1]


def test_fetch_kpi_achievement_never_reads_kpi_monthly_state(monkeypatch, settings):
    fake = _FakeClient(
        {
            "gold_alert_kpi_achievement": [],
            "tenant_kpi_targets": [],
        }
    )
    monkeypatch.setattr(data.Client, "from_url", lambda url: fake)

    data.fetch_kpi_achievement(settings)

    assert not any("kpi_monthly_state" in q for q in fake.executed)


class _RecordingClient:
    def __init__(self):
        self.executed = []

    def execute(self, query, rows=None):
        self.executed.append((query, rows))
        return []


def test_write_kpi_projection_writes_one_row_per_tenant_as_of_date_kpi_group(monkeypatch, settings):
    fake = _RecordingClient()
    monkeypatch.setattr(data.Client, "from_url", lambda url: fake)

    rows = [
        {
            "tenant_id": "locaweb",
            "as_of_date": pd.Timestamp("2026-08-21").date(),
            "kpi_group": "p1_p2",
            "median_breaches_ytd": 12.0,
            "ci80_lower": 8.0,
            "ci80_upper": 16.0,
            "p_within_target": 0.9,
        },
        {
            "tenant_id": "locaweb",
            "as_of_date": pd.Timestamp("2026-08-21").date(),
            "kpi_group": "p3",
            "median_breaches_ytd": 40.0,
            "ci80_lower": 30.0,
            "ci80_upper": 50.0,
            "p_within_target": None,
        },
    ]

    data.write_kpi_projection(settings, rows)

    insert_calls = [(q, r) for q, r in fake.executed if q.strip().upper().startswith("INSERT")]
    assert len(insert_calls) == 1
    _, inserted_rows = insert_calls[0]
    assert len(inserted_rows) == 2
    assert {row["kpi_group"] for row in inserted_rows} == {"p1_p2", "p3"}
    assert any("CREATE TABLE" in q for q, _ in fake.executed)
    assert any("gold_kpi_projection" in q for q, _ in fake.executed)
