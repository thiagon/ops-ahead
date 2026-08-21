import numpy as np
import pandas as pd
import pytest

from kpi_projection.run import run_kpi_projection
from settings import Settings


def _synthetic_daily(days: int = 75, start: str = "2025-01-01") -> pd.DataFrame:
    dates = pd.date_range(start, periods=days, freq="D")
    rng = np.random.default_rng(11)
    rows = []
    for date in dates:
        weekday_factor = 0.6 if date.dayofweek >= 5 else 1.0
        total = max(int((25 + 5 * np.sin(date.dayofyear / 30)) * weekday_factor + rng.integers(-2, 3)), 5)
        rows.append(
            {
                "date": date,
                "source": "itsm",
                "total_incidents": total,
                "p1_count": max(total // 12, 1),
                "p2_count": max(total // 6, 1),
                "p3_count": max(total // 3, 1),
                "avg_opened_hour": 12.0 + rng.integers(-1, 2),
            }
        )
    return pd.DataFrame(rows)


def _synthetic_kpi_state(month_start: pd.Timestamp) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"month": month_start, "severity": 1, "source": "itsm", "total": 50, "in_kpi": 48, "breached": 1},
            {"month": month_start, "severity": 2, "source": "itsm", "total": 200, "in_kpi": 180, "breached": 5},
            {"month": month_start, "severity": 3, "source": "itsm", "total": 400, "in_kpi": 380, "breached": 10},
        ]
    )


def _synthetic_achievement(month_start: pd.Timestamp, tenant_id: str = "locaweb") -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "tenant_id": tenant_id,
                "year": month_start.year,
                "month": month_start,
                "kpi_group": "p1_p2",
                "breached_in_month": 6,
                "breached_ytd": 6,
            },
            {
                "tenant_id": tenant_id,
                "year": month_start.year,
                "month": month_start,
                "kpi_group": "p3",
                "breached_in_month": 10,
                "breached_ytd": 10,
            },
        ]
    )


def _synthetic_targets(tenant_id: str = "locaweb") -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"tenant_id": tenant_id, "kpi_group": "p1_p2", "max_breaches": 39, "achievement_pct": 100},
            {"tenant_id": tenant_id, "kpi_group": "p1_p2", "max_breaches": 999999, "achievement_pct": 0},
            {"tenant_id": tenant_id, "kpi_group": "p3", "max_breaches": 263, "achievement_pct": 100},
            {"tenant_id": tenant_id, "kpi_group": "p3", "max_breaches": 999999, "achievement_pct": 0},
        ]
    )


@pytest.fixture
def synthetic_settings(tmp_path) -> Settings:
    return Settings(
        clickhouse_url="clickhouse://default:@localhost:9000/default",
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="kpi-monthly-projection-test",
        dataset_version="test-fixture",
        kpi_projection_n_simulations=200,
        kpi_projection_seed=1,
        kpi_projection_holdout_days=10,
    )


@pytest.fixture(autouse=True)
def _stub_write(monkeypatch):
    """Unit tests exercise the Monte Carlo/projection logic, not the
    ClickHouse write — that's covered in test_data.py."""
    monkeypatch.setattr("kpi_projection.run.write_kpi_projection", lambda settings, rows: None)


def test_run_kpi_projection_produces_the_two_kpi_group_bands(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    result = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets)

    assert result["run_id"]
    assert set(result["projections"].keys()) == {"p1_p2", "p3"}
    for summary in result["projections"].values():
        assert summary.ci80_lower <= summary.median <= summary.ci80_upper


def test_run_kpi_projection_reports_probability_against_the_annual_band(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    result = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets)

    assert result["projections"]["p1_p2"].p_within_target is not None
    assert result["projections"]["p3"].p_within_target is not None


def test_run_kpi_projection_reports_none_when_tenant_has_no_target(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()[0:0]  # no rows at all

    result = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets)

    assert result["projections"]["p1_p2"].p_within_target is None
    assert result["projections"]["p3"].p_within_target is None


def test_run_kpi_projection_writes_one_row_per_tenant_as_of_date_kpi_group(synthetic_settings, monkeypatch):
    written = []
    monkeypatch.setattr("kpi_projection.run.write_kpi_projection", lambda settings, rows: written.extend(rows))

    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")

    assert len(written) == 2
    assert {row["kpi_group"] for row in written} == {"p1_p2", "p3"}
    assert all(row["tenant_id"] == "locaweb" for row in written)
    assert len({row["as_of_date"] for row in written}) == 1


def test_same_seed_reproduces_same_medians(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    result_a = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets)
    result_b = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets)

    for key in result_a["projections"]:
        assert result_a["projections"][key].median == result_b["projections"][key].median
