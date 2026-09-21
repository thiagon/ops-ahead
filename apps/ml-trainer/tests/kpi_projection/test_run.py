import numpy as np
import pandas as pd
import pytest

from kpi_projection.run import _eligibility, _volume_parts, run_kpi_projection
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
                "p4_count": max(total // 8, 1),
                "p5_count": max(total // 15, 1),
                "avg_opened_hour": 12.0 + rng.integers(-1, 2),
            }
        )
    return pd.DataFrame(rows)


def _synthetic_kpi_state(month_start: pd.Timestamp, tenant_id: str = "locaweb") -> pd.DataFrame:
    return pd.DataFrame(
        [
            {"tenant_id": tenant_id, "month": month_start, "severity": 1, "source": "itsm", "total": 50, "in_kpi": 48, "breached": 1},
            {"tenant_id": tenant_id, "month": month_start, "severity": 2, "source": "itsm", "total": 200, "in_kpi": 180, "breached": 5},
            {"tenant_id": tenant_id, "month": month_start, "severity": 3, "source": "itsm", "total": 400, "in_kpi": 380, "breached": 10},
            {"tenant_id": tenant_id, "month": month_start, "severity": 4, "source": "itsm", "total": 120, "in_kpi": 110, "breached": 3},
        ]
    )


def _synthetic_achievement(
    month_start: pd.Timestamp, tenant_id: str = "locaweb", bands=((1, 2), (3,))
) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "tenant_id": tenant_id,
                "year": month_start.year,
                "month": month_start,
                "severities": band,
                "breached_in_month": 6,
                "breached_ytd": 6,
            }
            for band in bands
        ]
    )


def _synthetic_targets(tenant_id: str = "locaweb", bands=((1, 2), (3,))) -> pd.DataFrame:
    return pd.DataFrame(
        [
            row
            for band in bands
            for row in (
                {"tenant_id": tenant_id, "severities": band, "max_breaches": 39, "achievement_pct": 100},
                {"tenant_id": tenant_id, "severities": band, "max_breaches": 999999, "achievement_pct": 0},
            )
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


def test_run_kpi_projection_produces_the_bands_the_tenant_configured(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    result = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")

    assert result["run_id"]
    assert set(result["projections"].keys()) == {(1, 2), (3,)}
    for summary in result["projections"].values():
        assert summary.ci80_lower <= summary.median <= summary.ci80_upper


def test_run_kpi_projection_reports_probability_against_the_annual_band(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    result = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")

    assert result["projections"][(1, 2)].p_within_target is not None
    assert result["projections"][(3,)].p_within_target is not None


def test_run_kpi_projection_reports_none_when_the_band_has_no_100_pct_target(synthetic_settings):
    # The band is configured, so it projects; only the "at least met" row is
    # missing, and p_within_target has nothing to measure against.
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()
    targets = targets.loc[targets["achievement_pct"] != 100].reset_index(drop=True)

    result = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")

    assert result["projections"][(1, 2)].p_within_target is None
    assert result["projections"][(3,)].p_within_target is None


def test_run_kpi_projection_writes_one_row_per_tenant_as_of_date_band(synthetic_settings, monkeypatch):
    written = []
    monkeypatch.setattr("kpi_projection.run.write_kpi_projection", lambda settings, rows: written.extend(rows))

    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")

    assert len(written) == 2
    assert {tuple(row["severities"]) for row in written} == {(1, 2), (3,)}
    assert all(row["tenant_id"] == "locaweb" for row in written)
    assert len({row["as_of_date"] for row in written}) == 1


def test_same_seed_reproduces_same_medians(synthetic_settings):
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start)
    targets = _synthetic_targets()

    result_a = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")
    result_b = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")

    for key in result_a["projections"]:
        assert result_a["projections"][key].median == result_b["projections"][key].median


def test_a_band_the_dataset_never_had_projects_over_its_own_series(synthetic_settings, monkeypatch):
    # The band [1,2,4] is what proves the mapping is derived and not the old
    # hardcoded {p1_p2, p3}: it has to sum three volume series, p4 included.
    written = []
    monkeypatch.setattr("kpi_projection.run.write_kpi_projection", lambda settings, rows: written.extend(rows))

    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    bands = ((1, 2, 4),)
    kpi_state = _synthetic_kpi_state(month_start)
    achievement = _synthetic_achievement(month_start, bands=bands)
    targets = _synthetic_targets(bands=bands)

    result = run_kpi_projection(synthetic_settings, daily, kpi_state, achievement, targets, tenant_id="locaweb")

    assert set(result["projections"].keys()) == {(1, 2, 4)}
    assert [tuple(row["severities"]) for row in written] == [(1, 2, 4)]


def test_a_wider_band_sums_the_extra_severity_series(synthetic_settings):
    # What the band controls is which volume series are summed and whose
    # eligibility is read. The projected breach count is not monotonic in the
    # band's width — a wider band also has a larger eligible base, so the
    # sampled breach rate falls — which is why this asserts the inputs the
    # band selects, not the median it produces.
    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)
    kpi_state = _synthetic_kpi_state(month_start)

    assert _volume_parts((1, 2)) == ("p1", "p2")
    assert _volume_parts((1, 2, 4)) == ("p1", "p2", "p4")

    _, narrow_eligible = _eligibility(kpi_state, month_start, (1, 2))
    _, wide_eligible = _eligibility(kpi_state, month_start, (1, 2, 4))
    assert wide_eligible > narrow_eligible


def test_a_tenant_with_no_configured_band_projects_nothing(synthetic_settings, monkeypatch):
    # No target row means no band to project against — an empty result, not a
    # fallback to the p1_p2/p3 the dataset happened to have.
    written = []
    monkeypatch.setattr("kpi_projection.run.write_kpi_projection", lambda settings, rows: written.extend(rows))

    daily = _synthetic_daily()
    month_start = pd.Timestamp(daily["date"].max()).replace(day=1)

    result = run_kpi_projection(
        synthetic_settings,
        daily,
        _synthetic_kpi_state(month_start),
        _synthetic_achievement(month_start)[0:0],
        _synthetic_targets()[0:0],
        tenant_id="locaweb",
    )

    assert result["projections"] == {}
    assert written == []
