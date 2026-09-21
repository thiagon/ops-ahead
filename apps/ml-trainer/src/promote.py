"""Manual promotion CLI — for a training run started with `AUTO_PROMOTE=false`.

Usage: python -m promote <volume|breach> <tenant_id> <run_id>

Registers the run's logged model (if not already registered) and transitions
it to `Production`, archiving whatever version was there before. The tenant is
required: a model is registered per tenant, and promoting under a bare domain
name would put a version where no serving resolves it.
"""

from __future__ import annotations

import sys

import mlflow

from model_names import registered_model_name
from settings import Settings
from trigger import EXPERIMENT_NAMES


def promote_run(settings: Settings, domain: str, tenant_id: str, run_id: str) -> None:
    name = registered_model_name(EXPERIMENT_NAMES[domain], tenant_id)
    client = mlflow.MlflowClient(tracking_uri=settings.mlflow_tracking_uri)
    model_uri = f"runs:/{run_id}/model"

    versions = client.search_model_versions(f"name='{name}'")
    matching = [v for v in versions if v.run_id == run_id]
    if matching:
        version = matching[0].version
    else:
        model_version = client.create_model_version(name=name, source=model_uri, run_id=run_id)
        version = model_version.version

    client.transition_model_version_stage(
        name=name,
        version=version,
        stage="Production",
        archive_existing_versions=True,
    )
    print(f"Promoted {name} v{version} (run {run_id}) to Production.")


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in EXPERIMENT_NAMES:
        print("Usage: python -m promote <volume|breach> <tenant_id> <run_id>", file=sys.stderr)
        sys.exit(1)

    promote_run(Settings(), sys.argv[1], sys.argv[2], sys.argv[3])
