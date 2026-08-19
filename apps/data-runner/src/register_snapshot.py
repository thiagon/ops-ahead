from __future__ import annotations

import hashlib
import json
import logging

import mlflow
from clickhouse_driver import Client

from settings import Settings

LOGGER = logging.getLogger(__name__)


def compute_counts(client: Client, marts: list[str]) -> dict[str, int]:
    """One row count per mart — the same cheap signal the old inline
    WorkflowTemplate script used, ported verbatim."""
    counts: dict[str, int] = {}
    for mart in marts:
        rows = client.execute(f"SELECT count() FROM {mart}")
        counts[mart] = rows[0][0]
    return counts


def fingerprint(counts: dict[str, int]) -> str:
    return hashlib.sha256(json.dumps(counts, sort_keys=True).encode()).hexdigest()


def register_snapshot(settings: Settings, dag_run_id: str, client: Client | None = None) -> str:
    """Counts each configured mart, hashes the counts, and logs an MLflow run
    recording the fingerprint — the "data snapshot" step of the daily chain,
    now real Python inside data-runner instead of an inline script the old
    Argo WorkflowTemplate carried (see spec.md, "Removido nesta revisão").
    Returns the fingerprint hash. `client` is injectable for tests; the real
    entry points leave it unset and get one built from clickhouse_native_url.
    """
    client = client if client is not None else Client.from_url(settings.clickhouse_native_url)
    counts = compute_counts(client, settings.snapshot_marts)
    digest = fingerprint(counts)

    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment("data-pipeline-snapshots")
    with mlflow.start_run(run_name=dag_run_id):
        mlflow.log_param("hash", digest)
        mlflow.log_param("dag_run_id", dag_run_id)
        mlflow.set_tag("source", settings.source)
        for mart, count in counts.items():
            mlflow.log_metric(mart, count)

    LOGGER.info("snapshot registered: %s", digest)
    return digest
