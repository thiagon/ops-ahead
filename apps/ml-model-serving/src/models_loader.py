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
        mlflow.set_tracking_uri(self.settings.mlflow_tracking_uri)
        LOGGER.info("Loading %s/Production ...", self.settings.volume_model_name)
        self.volume_model = mlflow.pyfunc.load_model(f"models:/{self.settings.volume_model_name}/Production")
        LOGGER.info("Loading %s/Production ...", self.settings.breach_model_name)
        self.breach_model = mlflow.pyfunc.load_model(f"models:/{self.settings.breach_model_name}/Production")
        LOGGER.info("Both models loaded.")
