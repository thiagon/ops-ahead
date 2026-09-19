import pandas as pd
import pytest

from settings import Settings
from volume import data
from volume.data import dataset_version


class _RecordingClient:
    def __init__(self):
        self.executed = []

    def execute(self, query, rows=None):
        self.executed.append((query, rows))
        return []


@pytest.fixture
def settings() -> Settings:
    return Settings(clickhouse_url="clickhouse://default:@localhost:9000/default")


def test_write_volume_forecast_writes_one_row_per_target_date_priority_group_horizon(monkeypatch, settings):
    fake = _RecordingClient()
    monkeypatch.setattr(data.Client, "from_url", lambda url: fake)

    rows = [
        {
            "target_date": pd.Timestamp("2026-08-22").date(),
            "priority_group": "p1",
            "horizon": 1,
            "yhat": 5.0,
            "yhat_lower": 3.0,
            "yhat_upper": 7.0,
        },
        {
            "target_date": pd.Timestamp("2026-08-28").date(),
            "priority_group": "p1",
            "horizon": 7,
            "yhat": 6.0,
            "yhat_lower": 4.0,
            "yhat_upper": 8.0,
        },
    ]

    data.write_volume_forecast(settings, rows)

    insert_calls = [(q, r) for q, r in fake.executed if q.strip().upper().startswith("INSERT")]
    assert len(insert_calls) == 1
    _, inserted_rows = insert_calls[0]
    assert len(inserted_rows) == 2
    assert {(row["priority_group"], row["horizon"]) for row in inserted_rows} == {("p1", 1), ("p1", 7)}
    assert any("CREATE TABLE" in q for q, _ in fake.executed)
    assert any("gold_volume_forecast" in q for q, _ in fake.executed)


def test_dataset_version_is_deterministic():
    df = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=5), "total_incidents": [1, 2, 3, 4, 5]})

    assert dataset_version(df) == dataset_version(df.copy())


def test_dataset_version_changes_with_data():
    df1 = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=5), "total_incidents": [1, 2, 3, 4, 5]})
    df2 = df1.copy()
    df2.loc[0, "total_incidents"] = 99

    assert dataset_version(df1) != dataset_version(df2)
