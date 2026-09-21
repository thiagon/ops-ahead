from __future__ import annotations

import logging

import mlflow
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from recurring_causes.data import write_recurring_causes
from recurring_causes.features import (
    BEHAVIOUR_FEATURES,
    build_entity_features,
    entities_with_history,
)
from settings import Settings

LOGGER = logging.getLogger(__name__)


def choose_k(matrix: np.ndarray, k_min: int, k_max: int, seed: int) -> tuple[int, float, KMeans | None]:
    """Fixing k always yields k groups, including when there is no structure,
    and the result looks equally convincing either way. k comes from the best
    silhouette over a range, and that score is reported so a screen can say
    "no pattern found" instead of drawing invented groups."""
    upper = min(k_max, len(matrix) - 1)
    best: tuple[int, float, KMeans | None] = (0, -1.0, None)
    for k in range(k_min, upper + 1):
        model = KMeans(n_clusters=k, random_state=seed, n_init=10).fit(matrix)
        if len(set(model.labels_)) < 2:
            continue
        score = float(silhouette_score(matrix, model.labels_))
        if score > best[1]:
            best = (k, score, model)
    return best


def describe_groups(features: pd.DataFrame, labels: np.ndarray) -> dict[int, str]:
    """"Cluster 3" is not actionable. Each group is described by which
    behaviour features sit above or below the overall median, and by how much
    — the same job SHAP does for breach_risk: say why, not only what."""
    medians = features[BEHAVIOUR_FEATURES].median()
    descriptions: dict[int, str] = {}
    for group_id in sorted(set(labels)):
        members = features.loc[labels == group_id, BEHAVIOUR_FEATURES]
        deltas = {}
        for column in BEHAVIOUR_FEATURES:
            median = medians[column]
            if median == 0:
                continue
            ratio = (members[column].median() - median) / abs(median)
            if abs(ratio) >= 0.2:
                deltas[column] = ratio
        ranked = sorted(deltas.items(), key=lambda item: abs(item[1]), reverse=True)[:3]
        descriptions[int(group_id)] = "; ".join(
            f"{name} {'+' if ratio > 0 else ''}{round(ratio * 100)}%" for name, ratio in ranked
        )
    return descriptions


def _top_products(features: pd.DataFrame, labels: np.ndarray, group_id: int) -> str:
    members = features.loc[labels == group_id, "product"]
    counts = members.value_counts().head(3)
    return ", ".join(f"{product or '—'} ({count})" for product, count in counts.items())


def group_tenant(
    settings: Settings, breakdown: pd.DataFrame, tenant_id: str, as_of_date: pd.Timestamp
) -> dict:
    """One grouping per tenant — a group never mixes clients. A group spanning
    tenants has no reading: "these entities fail the same way" is actionable
    when one owner can act on all of them, and the description would expose one
    client's behaviour in another's screen."""
    features = entities_with_history(
        build_entity_features(breakdown, settings.recurring_causes_window_days),
        settings.recurring_causes_min_incidents,
    )
    if len(features) < settings.recurring_causes_k_min + 1:
        raise ValueError(
            f"tenant {tenant_id!r} has {len(features)} entities with enough history — too few to group"
        )

    matrix = StandardScaler().fit_transform(features[BEHAVIOUR_FEATURES].to_numpy(dtype=float))
    k, silhouette, model = choose_k(
        matrix, settings.recurring_causes_k_min, settings.recurring_causes_k_max, settings.recurring_causes_seed
    )
    if model is None:
        raise ValueError(f"tenant {tenant_id!r} produced no separable grouping")

    labels = model.labels_
    descriptions = describe_groups(features, labels)

    members = [
        {
            "tenant_id": tenant_id,
            "as_of_date": as_of_date.date(),
            "entity_id": row["entity_id"],
            "group_id": int(labels[i]),
            "category": row["category"],
            "product": row["product"],
            "incident_count": int(row["incident_count"]),
        }
        for i, row in features.iterrows()
    ]
    groups = [
        {
            "tenant_id": tenant_id,
            "as_of_date": as_of_date.date(),
            "group_id": group_id,
            "entity_count": int((labels == group_id).sum()),
            "silhouette": silhouette,
            "distinguishing_features": description,
            "top_products": _top_products(features, labels, group_id),
        }
        for group_id, description in descriptions.items()
    ]

    with mlflow.start_run(nested=True, run_name=tenant_id) as run:
        mlflow.log_param("tenant_id", tenant_id)
        mlflow.log_param("k", k)
        mlflow.log_param("entities_grouped", len(features))
        mlflow.log_metric("silhouette", silhouette)
        mlflow.sklearn.log_model(model, name="model")
        run_id = run.info.run_id

    write_recurring_causes(settings, members, groups)
    return {"run_id": run_id, "k": k, "silhouette": silhouette, "entities": len(features)}


def train_and_log(settings: Settings, breakdown: pd.DataFrame, dataset_version: str | None = None) -> str:
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment(settings.mlflow_experiment_name)

    as_of_date = pd.Timestamp(pd.to_datetime(breakdown["date"]).max())
    tenants = sorted(set(breakdown["tenant_id"]))
    if settings.tenant_id is not None:
        if settings.tenant_id not in tenants:
            raise ValueError(f"tenant {settings.tenant_id!r} has no rows in the window")
        tenants = [settings.tenant_id]

    grouped: dict[str, dict] = {}
    failed: dict[str, str] = {}

    with mlflow.start_run() as parent:
        mlflow.log_param("dataset_version", dataset_version or settings.dataset_version)
        mlflow.log_param("window_days", settings.recurring_causes_window_days)
        mlflow.log_param("tenants", ",".join(tenants))
        for tenant_id in tenants:
            try:
                grouped[tenant_id] = group_tenant(
                    settings, breakdown.loc[breakdown["tenant_id"] == tenant_id], tenant_id, as_of_date
                )
            except Exception as exc:
                LOGGER.exception("recurring_causes: tenant=%s failed", tenant_id)
                failed[tenant_id] = str(exc)
        mlflow.log_param("tenants_grouped", ",".join(grouped))
        mlflow.log_param("tenants_failed", ",".join(failed))
        mlflow.log_metric("tenants_grouped_count", len(grouped))
        return parent.info.run_id
