from __future__ import annotations

import pytest

from settings import Settings
from trigger import process_message


@pytest.fixture
def settings() -> Settings:
    return Settings()


@pytest.fixture
def published() -> list[dict]:
    return []


@pytest.fixture
def publish_status(published):
    def _publish(payload: dict) -> None:
        published.append(payload)

    return _publish


class TestProcessMessage:
    def test_translates_volume_forecast_locally_and_trains(self, settings, published, publish_status):
        calls: list[Settings] = []

        def _train_volume(s: Settings) -> str:
            calls.append(s)
            return "mlflow-run-abc"

        process_message(
            settings,
            {"volume": _train_volume, "breach": lambda s: "unused"},
            {
                "run_id": "run-1",
                "analysis": "volume_forecast",
                "train_end": "2025-09-30",
                "validation_end": "2025-10-31",
                "holdout_end": "2026-01-31",
            },
            publish_status,
        )

        assert len(calls) == 1
        assert calls[0].train_end == "2025-09-30"
        assert calls[0].validation_end == "2025-10-31"
        assert calls[0].holdout_end == "2026-01-31"
        assert calls[0].mlflow_experiment_name == "volume-forecast"

        assert published[0] == {"run_id": "run-1", "status": "Running", "started_at": published[0]["started_at"]}
        assert published[1]["status"] == "Succeeded"
        assert published[1]["run_id"] == "run-1"
        assert published[1]["detail"] == {"mlflow_run_id": "mlflow-run-abc"}
        assert "finished_at" in published[1]

    def test_translates_breach_risk_locally_and_trains(self, settings, published, publish_status):
        calls: list[Settings] = []

        def _train_breach(s: Settings) -> str:
            calls.append(s)
            return "mlflow-run-xyz"

        process_message(
            settings,
            {"volume": lambda s: "unused", "breach": _train_breach},
            {
                "run_id": "run-2",
                "analysis": "breach_risk",
                "train_end": "2025-02-15",
                "validation_end": "2025-03-15",
                "holdout_end": "2025-04-09",
            },
            publish_status,
        )

        assert len(calls) == 1
        assert calls[0].mlflow_experiment_name == "breach-risk"
        assert published[1]["detail"] == {"mlflow_run_id": "mlflow-run-xyz"}

    def test_second_message_of_a_different_domain_does_not_inherit_the_first_domains_model_name(
        self, settings, published, publish_status
    ):
        # settings is one mutable instance reused across both calls (as
        # consume_forever does across messages) — snapshot the field at call
        # time, not the object reference, or both entries just show the
        # final state.
        experiment_names_seen: list[str | None] = []

        def _train_breach(s: Settings) -> str:
            experiment_names_seen.append(s.mlflow_experiment_name)
            return "mlflow-run-breach"

        def _train_volume(s: Settings) -> str:
            experiment_names_seen.append(s.mlflow_experiment_name)
            return "mlflow-run-volume"

        trainers = {"volume": _train_volume, "breach": _train_breach}

        process_message(
            settings,
            trainers,
            {
                "run_id": "run-a",
                "analysis": "breach_risk",
                "train_end": "2025-02-15",
                "validation_end": "2025-03-15",
                "holdout_end": "2025-04-09",
            },
            publish_status,
        )
        process_message(
            settings,
            trainers,
            {
                "run_id": "run-b",
                "analysis": "volume_forecast",
                "train_end": "2025-09-30",
                "validation_end": "2025-10-31",
                "holdout_end": "2026-01-31",
            },
            publish_status,
        )

        assert experiment_names_seen == ["breach-risk", "volume-forecast"]
        assert settings.mlflow_registered_model_name == "volume-forecast"

    def test_publishes_failed_with_error_detail_when_the_trainer_raises(
        self, settings, published, publish_status
    ):
        def _train_volume(s: Settings) -> str:
            raise ValueError("empty validation partition after temporal_split")

        process_message(
            settings,
            {"volume": _train_volume, "breach": lambda s: "unused"},
            {"run_id": "run-3", "analysis": "volume_forecast", "train_end": "a", "validation_end": "b", "holdout_end": "c"},
            publish_status,
        )

        assert published[0]["status"] == "Running"
        assert published[1] == {
            "run_id": "run-3",
            "status": "Failed",
            "started_at": published[0]["started_at"],
            "finished_at": published[1]["finished_at"],
            "detail": {"error": "empty validation partition after temporal_split"},
        }

    def test_drops_a_malformed_event_without_publishing_or_crashing(self, settings, published, publish_status):
        process_message(settings, {"volume": lambda s: "x", "breach": lambda s: "x"}, {"run_id": "run-4"}, publish_status)

        assert published == []

    def test_drops_an_event_with_unknown_analysis_without_publishing(self, settings, published, publish_status):
        process_message(
            settings,
            {"volume": lambda s: "x", "breach": lambda s: "x"},
            {"run_id": "run-5", "analysis": "data_refresh"},
            publish_status,
        )

        assert published == []
