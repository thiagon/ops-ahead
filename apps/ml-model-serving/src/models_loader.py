from __future__ import annotations

import logging

import mlflow.pyfunc

from src.settings import Settings

LOGGER = logging.getLogger(__name__)


class ModelRegistry:
    """Holds the loaded `Production`-stage pyfunc models. `volume_model` /
    `breach_model` stay `None` until `load()` runs (app startup) — tests build
    a registry and set these directly, skipping the real MLflow round-trip."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.volume_model = None
        self.breach_model = None

    def load(self) -> None:
        """Best-effort: a model that isn't in `Production` yet (no training
        run has promoted one) is a normal, expected startup state — not a
        reason to crash the process. Letting `mlflow.pyfunc.load_model` raise
        past this point would take the whole app down before it ever binds a
        port, so `/health` could never report *why* it's not ready, and
        Kubernetes would crash-loop it forever instead of just holding it at
        `not ready` until a Production model shows up on a later rollout."""
        mlflow.set_tracking_uri(self.settings.mlflow_tracking_uri)

        try:
            LOGGER.info("Loading %s/Production ...", self.settings.volume_model_name)
            self.volume_model = mlflow.pyfunc.load_model(f"models:/{self.settings.volume_model_name}/Production")
        except Exception:
            LOGGER.warning("%s/Production not available yet.", self.settings.volume_model_name, exc_info=True)

        try:
            LOGGER.info("Loading %s/Production ...", self.settings.breach_model_name)
            self.breach_model = mlflow.pyfunc.load_model(f"models:/{self.settings.breach_model_name}/Production")
        except Exception:
            LOGGER.warning("%s/Production not available yet.", self.settings.breach_model_name, exc_info=True)
