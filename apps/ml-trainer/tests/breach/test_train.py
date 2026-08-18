import numpy as np
import pandas as pd
import pytest

from breach.train import train_and_log
from settings import Settings


def _synthetic_incidents(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(11)
    dates = pd.date_range("2025-01-01", periods=n, freq="8h")
    groups = rng.choice(["Team14", "TeamX", "TeamY"], size=n)
    severities = rng.choice([1, 2, 3], size=n)
    ola_limit = np.where(severities <= 2, 14400, 43200)
    # Breach probability skewed by severity/group so the model has *some*
    # learnable signal, at a rate high enough that small synthetic splits
    # still contain positives in every partition.
    breach_prob = np.clip(0.1 + (severities == 1) * 0.25 + (groups == "TeamX") * 0.15, 0, 0.9)
    breached = rng.random(n) < breach_prob
    duration = np.where(breached, ola_limit * rng.uniform(1.1, 2.0, n), ola_limit * rng.uniform(0.1, 0.9, n))

    return pd.DataFrame(
        {
            "event_id": [f"e{i}" for i in range(n)],
            "entity_id": [f"ic{i % 5}" for i in range(n)],
            "ticket_number": [f"INC{i}" for i in range(n)],
            "received_at": dates,
            "opened_at": dates,
            "assignment_group": groups,
            "opened_by": rng.choice(["Manual", "Monitoramento"], size=n),
            "has_parent_incident": 0,
            "status": "Encerrado",
            "severity": severities,
            "duration_seconds": duration.astype(int),
            "ola_limit_seconds": ola_limit,
            "kpi_breached": breached.astype(int),
        }
    )


@pytest.fixture
def synthetic_settings(tmp_path) -> Settings:
    return Settings(
        clickhouse_url="clickhouse://default:@localhost:9000/default",
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="breach-risk-test",
        dataset_version="test-fixture",
        # _synthetic_incidents(n=300) at freq="8h" spans 2025-01-01..2025-04-10.
        train_end="2025-02-15",
        validation_end="2025-03-15",
        holdout_end="2025-04-09",
        auto_promote=False,
    )


def test_train_and_log_completes_and_logs_a_run(synthetic_settings):
    incidents = _synthetic_incidents()
    empty_p4 = pd.DataFrame(columns=["entity_id", "sequence_start", "sequence_end", "sequence_length"])
    empty_ic = pd.DataFrame(columns=["entity_id", "window_hours", "window_start", "no_intervention_count"])
    empty_group_load = pd.DataFrame(columns=["assignment_group", "window_start", "incidents_opened"])
    empty_priority_changes = pd.DataFrame(columns=["ticket_number", "received_at", "severity_from", "severity_to"])

    run_id = train_and_log(
        synthetic_settings, incidents, empty_p4, empty_ic, empty_group_load, empty_priority_changes, n_trials=3
    )

    assert run_id
