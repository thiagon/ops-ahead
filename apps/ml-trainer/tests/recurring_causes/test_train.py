from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from recurring_causes.features import BEHAVIOUR_FEATURES
from recurring_causes.train import choose_k, describe_groups, train_and_log
from settings import Settings


def _synthetic_breakdown(tenant_id: str = "locaweb") -> pd.DataFrame:
    """Two behaviours that cut across products: 'slow burners' fail rarely and
    take long, 'flappers' fail constantly and resolve fast. Each behaviour is
    spread over two products on purpose — the grouping must find the behaviour,
    not the product."""
    rng = np.random.default_rng(7)
    rows = []
    dates = pd.date_range("2026-06-01", periods=40, freq="D")

    for i in range(6):
        product = "vps" if i % 2 == 0 else "cloud"
        for date in dates[::7]:
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "date": date,
                    "category": "rede",
                    "product": product,
                    "entity_id": f"slow-{i}",
                    "severity": 2,
                    "incident_count": int(rng.integers(1, 3)),
                    "breached": 1,
                    "avg_duration_seconds": float(rng.integers(30000, 36000)),
                }
            )

    for i in range(6):
        product = "vps" if i % 2 == 0 else "cloud"
        for date in dates:
            rows.append(
                {
                    "tenant_id": tenant_id,
                    "date": date,
                    "category": "rede",
                    "product": product,
                    "entity_id": f"flap-{i}",
                    "severity": 4,
                    "incident_count": int(rng.integers(5, 9)),
                    "breached": 0,
                    "avg_duration_seconds": float(rng.integers(120, 400)),
                }
            )

    return pd.DataFrame(rows)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        clickhouse_url="clickhouse://default:@localhost:9000/default",
        mlflow_tracking_uri=f"sqlite:///{tmp_path}/mlflow.db",
        mlflow_experiment_name="recurring-causes-test",
        dataset_version="test-fixture",
        recurring_causes_window_days=40,
        recurring_causes_min_incidents=5,
    )


@pytest.fixture(autouse=True)
def _stub_write(monkeypatch):
    monkeypatch.setattr("recurring_causes.train.write_recurring_causes", lambda s, m, g: None)


def test_choose_k_reports_the_score_it_selected_on():
    rng = np.random.default_rng(1)
    matrix = np.vstack([rng.normal(0, 0.1, (20, 3)), rng.normal(8, 0.1, (20, 3))])

    k, silhouette, model = choose_k(matrix, k_min=2, k_max=6, seed=0)

    assert k == 2
    assert silhouette > 0.8
    assert model is not None


def test_choose_k_reports_a_low_score_when_there_is_no_structure():
    # The screen has to be able to say "no pattern found" rather than draw
    # groups that the data does not support.
    rng = np.random.default_rng(2)
    matrix = rng.normal(0, 1, (60, 4))

    _, silhouette, _ = choose_k(matrix, k_min=2, k_max=6, seed=0)

    assert silhouette < 0.3


def test_a_group_spans_products_when_the_behaviour_does(settings, monkeypatch):
    # The verification the spec asks for: entities of different products land
    # in one group, described by the behaviour they share.
    written = {}
    monkeypatch.setattr(
        "recurring_causes.train.write_recurring_causes",
        lambda s, members, groups: written.update({"members": members, "groups": groups}),
    )

    train_and_log(settings, _synthetic_breakdown())

    members = pd.DataFrame(written["members"])
    slow_group = members.loc[members["entity_id"].str.startswith("slow"), "group_id"]
    flap_group = members.loc[members["entity_id"].str.startswith("flap"), "group_id"]

    assert slow_group.nunique() == 1
    assert flap_group.nunique() == 1
    assert slow_group.iat[0] != flap_group.iat[0]
    # The behaviour groups cut across products, which is the whole point.
    assert members.loc[members["group_id"] == slow_group.iat[0], "product"].nunique() == 2


def test_each_group_is_described_by_what_distinguishes_it(settings, monkeypatch):
    written = {}
    monkeypatch.setattr(
        "recurring_causes.train.write_recurring_causes",
        lambda s, members, groups: written.update({"members": members, "groups": groups}),
    )

    train_and_log(settings, _synthetic_breakdown())

    for group in written["groups"]:
        assert group["distinguishing_features"]
        assert group["entity_count"] > 0
        assert group["top_products"]


def test_describe_groups_names_the_feature_and_its_direction():
    features = pd.DataFrame(
        {
            **{column: [1.0, 1.0, 5.0, 5.0] for column in BEHAVIOUR_FEATURES},
            "entity_id": ["a", "b", "c", "d"],
        }
    )
    labels = np.array([0, 0, 1, 1])

    descriptions = describe_groups(features, labels)

    assert "+" in descriptions[1]
    assert descriptions[0].startswith(BEHAVIOUR_FEATURES[0]) or "-" in descriptions[0]


def test_a_tenant_with_too_few_entities_fails_without_costing_the_others(settings, monkeypatch):
    written = {}
    monkeypatch.setattr(
        "recurring_causes.train.write_recurring_causes",
        lambda s, members, groups: written.setdefault("members", []).extend(members),
    )

    tiny = _synthetic_breakdown(tenant_id="acme")
    tiny = tiny.loc[tiny["entity_id"] == "flap-0"]
    breakdown = pd.concat([_synthetic_breakdown(), tiny])

    train_and_log(settings, breakdown)

    tenants = {row["tenant_id"] for row in written["members"]}
    assert tenants == {"locaweb"}


def test_entities_never_mix_across_tenants(settings, monkeypatch):
    written = []
    monkeypatch.setattr(
        "recurring_causes.train.write_recurring_causes",
        lambda s, members, groups: written.extend(members),
    )

    breakdown = pd.concat([_synthetic_breakdown(), _synthetic_breakdown(tenant_id="acme")])

    train_and_log(settings, breakdown)

    by_tenant = pd.DataFrame(written).groupby("tenant_id")["entity_id"].apply(set)
    assert len(by_tenant) == 2
    # Same entity ids on both sides, grouped separately — never one shared pool.
    assert by_tenant["locaweb"] == by_tenant["acme"]
