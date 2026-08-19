from __future__ import annotations

import logging

import mlflow.pyfunc

from settings import Settings

LOGGER = logging.getLogger(__name__)


class ModelVersionNotFound(Exception):
    """A version requested via the A/B header doesn't exist in the MLflow registry."""


class ModelRegistry:
    """Holds the loaded `Production`-stage pyfunc models. `volume_model` /
    `breach_model` stay `None` until `load()` runs (app startup) — tests build
    a registry and set these directly, skipping the real MLflow round-trip.

    Non-`Production` versions requested through the A/B header (see
    `service.py`) are loaded lazily on first request and cached per version —
    eager-loading every version up front would defeat the point of A/B being
    opt-in per request."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.volume_model = None
        self.breach_model = None
        self._version_cache: dict[tuple[str, str], object] = {}

    def load(self) -> None:
        """Best-effort: a model that isn't in `Production` yet (no training
        run has promoted one) is a normal, expected startup state — not a
        reason to crash the process. Letting `mlflow.pyfunc.load_model` raise
        past this point would take the whole app down before it ever binds a
        port, so the readiness probe could never report *why* it's not ready,
        and Kubernetes would crash-loop it forever instead of just holding it
        at `not ready` until a Production model shows up on a later rollout."""
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

    def _model_for_version(self, model_name: str, production_model: object | None, version: str | None) -> object:
        if version is None:
            return production_model

        cache_key = (model_name, version)
        if cache_key not in self._version_cache:
            try:
                self._version_cache[cache_key] = mlflow.pyfunc.load_model(f"models:/{model_name}/{version}")
            except Exception as exc:
                raise ModelVersionNotFound(f"{model_name} version {version!r} not found") from exc
        return self._version_cache[cache_key]

    def volume_model_for(self, version: str | None) -> object:
        return self._model_for_version(self.settings.volume_model_name, self.volume_model, version)

    def breach_model_for(self, version: str | None) -> object:
        return self._model_for_version(self.settings.breach_model_name, self.breach_model, version)
