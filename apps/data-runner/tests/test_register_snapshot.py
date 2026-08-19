from __future__ import annotations

import pytest

from register_snapshot import compute_counts, fingerprint, register_snapshot
from settings import Settings


class FakeClient:
    """In-memory stand-in for clickhouse_driver.Client — no real ClickHouse."""

    def __init__(self, counts: dict[str, int]) -> None:
        self._counts = counts

    def execute(self, query: str):
        mart = query.rsplit(" ", 1)[-1]
        return [(self._counts[mart],)]


def test_compute_counts_reads_one_row_count_per_mart():
    client = FakeClient({"incidents_by_ic": 42, "kpi_monthly_state": 7})

    counts = compute_counts(client, ["incidents_by_ic", "kpi_monthly_state"])

    assert counts == {"incidents_by_ic": 42, "kpi_monthly_state": 7}


def test_fingerprint_is_deterministic_and_key_order_independent():
    a = fingerprint({"incidents_by_ic": 42, "kpi_monthly_state": 7})
    b = fingerprint({"kpi_monthly_state": 7, "incidents_by_ic": 42})

    assert a == b
    assert len(a) == 64  # sha256 hex digest


def test_fingerprint_changes_when_a_count_changes():
    a = fingerprint({"incidents_by_ic": 42})
    b = fingerprint({"incidents_by_ic": 43})

    assert a != b


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        snapshot_marts=["incidents_by_ic", "kpi_monthly_state"],
        source="itsm",
    )


def test_register_snapshot_logs_a_run_with_the_fingerprint_and_counts(settings):
    client = FakeClient({"incidents_by_ic": 42, "kpi_monthly_state": 7})

    digest = register_snapshot(settings, dag_run_id="daily-2026-08-16", client=client)

    import mlflow

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    run = mlflow.search_runs(
        experiment_names=["data-pipeline-snapshots"], filter_string="tags.source = 'itsm'"
    ).iloc[0]

    assert run["params.hash"] == digest
    assert run["params.dag_run_id"] == "daily-2026-08-16"
    assert run["metrics.incidents_by_ic"] == 42
    assert run["metrics.kpi_monthly_state"] == 7
