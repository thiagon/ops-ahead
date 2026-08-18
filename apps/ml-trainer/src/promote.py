"""Manual promotion CLI — for a training run started with `AUTO_PROMOTE=false`.

Usage: python -m promote <volume|breach> <run_id>

Registers the run's logged model (if not already registered) and transitions
it to `Production`, archiving whatever version was there before.
"""

from __future__ import annotations

import sys

import mlflow

from main import EXPERIMENT_NAMES
from settings import Settings


def promote_run(settings: Settings, run_id: str) -> None:
    client = mlflow.MlflowClient(tracking_uri=settings.mlflow_tracking_uri)
    model_uri = f"runs:/{run_id}/model"

    versions = client.search_model_versions(f"name='{settings.mlflow_registered_model_name}'")
    matching = [v for v in versions if v.run_id == run_id]
    if matching:
        version = matching[0].version
    else:
        model_version = client.create_model_version(
            name=settings.mlflow_registered_model_name, source=model_uri, run_id=run_id
        )
        version = model_version.version

    client.transition_model_version_stage(
        name=settings.mlflow_registered_model_name,
        version=version,
        stage="Production",
        archive_existing_versions=True,
    )
    print(f"Promoted {settings.mlflow_registered_model_name} v{version} (run {run_id}) to Production.")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in EXPERIMENT_NAMES:
        print("Usage: python -m promote <volume|breach> <run_id>", file=sys.stderr)
        sys.exit(1)

    domain, run_id = sys.argv[1], sys.argv[2]
    settings = Settings()
    if settings.mlflow_registered_model_name is None:
        settings.mlflow_registered_model_name = EXPERIMENT_NAMES[domain]
    promote_run(settings, run_id)
