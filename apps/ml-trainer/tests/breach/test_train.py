import numpy as np
import pandas as pd
import pytest

from breach.train import train_and_log
from settings import Settings


def _synthetic_examples(n: int = 300) -> pd.DataFrame:
    rng = np.random.default_rng(11)
    dates = pd.date_range("2025-01-01", periods=n, freq="8h")
    owners = rng.choice(["Team14", "TeamX", "TeamY"], size=n)
    severities = rng.choice([1, 2, 3], size=n)
    deadline_seconds = np.where(severities <= 2, 14400, 43200)
    # Breach probability skewed by severity/owner so the model has *some*
    # learnable signal, at a rate high enough that small synthetic splits
    # still contain positives in every partition.
    breach_prob = np.clip(0.1 + (severities == 1) * 0.25 + (owners == "TeamX") * 0.15, 0, 0.9)
    breached = rng.random(n) < breach_prob
    duration = np.where(
        breached, deadline_seconds * rng.uniform(1.1, 2.0, n), deadline_seconds * rng.uniform(0.1, 0.9, n)
    )
    duration = duration.astype(int)
    consumed_ratio_final = duration / deadline_seconds

    return pd.DataFrame(
        {
            "milestone_id": [f"m{i}" for i in range(n)],
            "tenant_id": ["locaweb"] * n,
            "source": ["itsm"] * n,
            "external_id": [f"INC{i}" for i in range(n)],
            "entity_id": [f"ic{i % 5}" for i in range(n)],
            "kind": ["pct_25"] * n,
            "severity_at_milestone": severities,
            "opened_at": dates,
            "acknowledged_at_at_milestone": pd.NaT,
            "due_at": dates + pd.to_timedelta(deadline_seconds, unit="s"),
            "deadline_seconds": deadline_seconds,
            "consumed_ratio_at_milestone": 0.25,
            "occurred_at": dates + pd.Timedelta(hours=1),
            "owner": owners,
            "reported_by": rng.choice(["manual", "monitoring"], size=n),
            "parent_id": "",
            "resolution_code": "",
            "status": "resolved",
            "severity_changes": 0,
            "is_eligible": True,
            "group_load": rng.integers(0, 10, size=n),
            "no_intervention_count_1h": rng.integers(0, 3, size=n),
            "no_intervention_count_6h": rng.integers(0, 5, size=n),
            "no_intervention_precursor_length": rng.integers(0, 3, size=n),
            "has_breached": breached,
            "final_consumed_ratio": consumed_ratio_final,
            "final_duration_seconds": duration,
        }
    )


def _synthetic_monitor_context() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    entities = [f"ic{i}" for i in range(5)]
    signal_counts = pd.DataFrame(columns=["entity_id", "window_minutes", "window_start", "signal_count"])
    auto_resolution_rate = pd.DataFrame({"entity_id": entities, "auto_resolution_rate": [0.5] * len(entities)})
    severity_escalations = pd.DataFrame(columns=["entity_id", "date", "escalation_count"])
    return signal_counts, auto_resolution_rate, severity_escalations


@pytest.fixture
def synthetic_settings(tmp_path) -> Settings:
    return Settings(
        clickhouse_url="clickhouse://default:@localhost:9000/default",
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="breach-risk-test",
        dataset_version="test-fixture",
        # _synthetic_examples(n=300) at freq="8h" spans 2025-01-01..2025-04-10.
        train_end="2025-02-15",
        validation_end="2025-03-15",
        holdout_end="2025-04-09",
        auto_promote=False,
    )


def test_train_and_log_completes_and_logs_a_run(synthetic_settings):
    examples = _synthetic_examples()
    signal_counts, auto_resolution_rate, severity_escalations = _synthetic_monitor_context()

    run_id = train_and_log(
        synthetic_settings, examples, signal_counts, auto_resolution_rate, severity_escalations, n_trials=3
    )

    assert run_id
