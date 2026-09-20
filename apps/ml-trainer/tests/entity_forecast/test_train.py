from __future__ import annotations

import pandas as pd

from entity_forecast import features, train
from settings import Settings


def _trends(pairs: list[tuple[str, str]], days: int = 200) -> pd.DataFrame:
    rows = []
    for category, product in pairs:
        for offset in range(days):
            rows.append(
                {
                    "tenant_id": "locaweb",
                    "date": pd.Timestamp("2025-01-01") + pd.Timedelta(days=offset),
                    "category": category,
                    "product": product,
                    "total_incidents": 20 + (offset % 7) * 3,
                }
            )
    return pd.DataFrame(rows)


def _settings() -> Settings:
    return Settings(
        train_end="2025-04-30",
        validation_end="2025-05-31",
        holdout_end="2025-07-19",
        entity_min_history_days=60,
    )


def test_train_horizon_learns_the_weekly_shape_over_every_series():
    result = train.train_horizon(_trends([("cat1", "prodA"), ("cat2", "prodB")]), _settings(), 1)

    assert result["series_count"] == 2
    # A flat weekly pattern is easy; this only asserts the model is not wildly
    # off, which is what would happen if the series categories were misaligned.
    assert result["metrics"]["mae"] < 10


def test_forecast_rows_carry_the_series_back_as_its_own_columns():
    settings = _settings()
    trends = _trends([("cat1", "prodA"), ("cat2", "prodB")])
    results = {h: train.train_horizon(trends, settings, h) for h in train.HORIZONS}

    rows = train._forecast_rows(trends, settings, results, "locaweb")

    assert {row["category"] for row in rows} == {"cat1", "cat2"}
    assert {row["product"] for row in rows} == {"prodA", "prodB"}
    assert {row["tenant_id"] for row in rows} == {"locaweb"}
    assert {row["horizon"] for row in rows} == set(train.HORIZONS)
    assert all(row["yhat_lower"] <= row["yhat"] <= row["yhat_upper"] for row in rows)
    assert all(row["yhat_lower"] >= 0 for row in rows)


def test_a_thin_product_is_forecast_inside_the_residual_series():
    settings = _settings()
    trends = pd.concat([_trends([("cat1", "prodA")]), _trends([("cat9", "rare")], days=20)])
    results = {h: train.train_horizon(trends, settings, h) for h in train.HORIZONS}

    rows = train._forecast_rows(trends, settings, results, "locaweb")

    products = {row["product"] for row in rows}
    assert "rare" not in products
    assert features.RESIDUAL_LABEL in products


def test_tenants_come_from_the_data_and_thin_ones_are_skipped_not_failed():
    trends = pd.concat(
        [
            _trends([("cat1", "prodA")]),
            _trends([("cat1", "prodA")], days=10).assign(tenant_id="acme"),
        ]
    )

    assert train.tenants_with_history(trends, 60) == ["locaweb"]


def test_a_tenant_is_never_trained_on_another_tenants_volume(monkeypatch):
    """The whole reason the tenant is in the grain: two clients with a product
    of the same name must not become one series."""
    trends = pd.concat(
        [
            _trends([("cat1", "prodA")]),
            _trends([("cat1", "prodA")]).assign(tenant_id="acme", total_incidents=900),
        ]
    )
    seen: dict[str, set] = {}

    def _fake_train_tenant(settings, tenant_trends, tenant_id, dataset_version):
        seen[tenant_id] = set(tenant_trends["total_incidents"])
        return f"run-{tenant_id}"

    monkeypatch.setattr(train, "train_tenant", _fake_train_tenant)
    monkeypatch.setattr(train.mlflow, "set_tracking_uri", lambda *a: None)
    monkeypatch.setattr(train.mlflow, "set_experiment", lambda *a: None)
    monkeypatch.setattr(train.mlflow, "log_param", lambda *a, **kw: None)
    monkeypatch.setattr(train.mlflow, "log_metric", lambda *a, **kw: None)

    class _Run:
        info = type("I", (), {"run_id": "parent"})()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(train.mlflow, "start_run", lambda *a, **kw: _Run())

    train.train_and_log(_settings(), trends)

    assert set(seen) == {"acme", "locaweb"}
    assert seen["acme"] == {900}
    assert 900 not in seen["locaweb"]


def test_one_tenant_failing_does_not_cost_the_others(monkeypatch):
    trends = pd.concat(
        [_trends([("cat1", "prodA")]), _trends([("cat1", "prodA")]).assign(tenant_id="acme")]
    )

    def _fake_train_tenant(settings, tenant_trends, tenant_id, dataset_version):
        if tenant_id == "acme":
            raise RuntimeError("clickhouse unreachable")
        return "run-locaweb"

    logged: dict[str, str] = {}
    monkeypatch.setattr(train, "train_tenant", _fake_train_tenant)
    monkeypatch.setattr(train.mlflow, "set_tracking_uri", lambda *a: None)
    monkeypatch.setattr(train.mlflow, "set_experiment", lambda *a: None)
    monkeypatch.setattr(train.mlflow, "log_param", lambda k, v: logged.__setitem__(k, v))
    monkeypatch.setattr(train.mlflow, "log_metric", lambda *a, **kw: None)

    class _Run:
        info = type("I", (), {"run_id": "parent"})()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(train.mlflow, "start_run", lambda *a, **kw: _Run())

    run_id = train.train_and_log(_settings(), trends)

    assert run_id == "parent"
    assert logged["tenants_trained"] == "locaweb"
    assert logged["tenants_failed"] == "acme"
