from __future__ import annotations

import pytest

from settings import Settings
from trigger import process_message


@pytest.fixture
def settings() -> Settings:
    return Settings(source="itsm")


@pytest.fixture
def published() -> list[dict]:
    return []


@pytest.fixture
def publish_status(published):
    def _publish(payload: dict) -> None:
        published.append(payload)

    return _publish


def _fake_steps(calls: list[tuple]) -> dict:
    return {
        "transform": lambda: calls.append(("transform",)),
        "quality": lambda argv: calls.append(("quality", tuple(argv))),
    }


class TestProcessMessage:
    def test_data_refresh_runs_only_transform(self, settings, published, publish_status):
        calls: list[tuple] = []

        process_message(
            settings,
            {"run_id": "run-1", "analysis": "data_refresh"},
            publish_status,
            steps=_fake_steps(calls),
        )

        assert calls == [("transform",)]
        assert published[0]["status"] == "running"
        assert published[1] == {
            "run_id": "run-1",
            "status": "succeeded",
            "started_at": published[0]["started_at"],
            "finished_at": published[1]["finished_at"],
        }

    def test_data_quality_check_runs_only_the_critical_suite(self, settings, published, publish_status):
        calls: list[tuple] = []

        process_message(
            settings,
            {"run_id": "run-2", "analysis": "data_quality_check"},
            publish_status,
            steps=_fake_steps(calls),
        )

        assert calls == [("quality", ("--suite", "critical", "--upload-docs"))]
        assert published[1]["status"] == "succeeded"

    def test_full_pipeline_runs_transform_then_quality_then_register_snapshot(
        self, settings, published, publish_status
    ):
        calls: list[tuple] = []

        def _fake_register_snapshot(s: Settings, dag_run_id: str) -> str:
            calls.append(("register_snapshot", dag_run_id))
            return "abc123"

        process_message(
            settings,
            {"run_id": "daily-2026-08-16", "analysis": "full_pipeline"},
            publish_status,
            steps=_fake_steps(calls),
            register_snapshot=_fake_register_snapshot,
        )

        assert calls == [
            ("transform",),
            ("quality", ("--suite", "critical", "--upload-docs")),
            ("register_snapshot", "daily-2026-08-16"),
        ]
        assert published[1]["status"] == "succeeded"
        assert published[1]["detail"] == {"snapshot_hash": "abc123"}

    def test_publishes_failed_with_error_detail_when_a_step_raises(self, settings, published, publish_status):
        def _raising_transform() -> None:
            raise RuntimeError("dbt run failed: connection refused")

        process_message(
            settings,
            {"run_id": "run-3", "analysis": "data_refresh"},
            publish_status,
            steps={"transform": _raising_transform, "quality": lambda argv: None},
        )

        assert published[0]["status"] == "running"
        assert published[1] == {
            "run_id": "run-3",
            "status": "failed",
            "started_at": published[0]["started_at"],
            "finished_at": published[1]["finished_at"],
            "detail": {"error": "dbt run failed: connection refused"},
        }

    def test_drops_a_malformed_event_without_publishing_or_crashing(self, settings, published, publish_status):
        process_message(settings, {"run_id": "run-4"}, publish_status)

        assert published == []

    def test_drops_an_event_with_unknown_analysis_without_publishing(self, settings, published, publish_status):
        process_message(settings, {"run_id": "run-5", "analysis": "volume_forecast"}, publish_status)

        assert published == []
