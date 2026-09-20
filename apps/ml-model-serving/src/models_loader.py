from __future__ import annotations

import logging

import mlflow.pyfunc

from settings import Settings

LOGGER = logging.getLogger(__name__)

# Same rule ml-trainer registers under (apps/ml-trainer/src/model_names.py).
# Duplicated rather than imported because the two apps ship as separate images;
# a change on either side has to move both, which the contract test in
# tests/test_models_loader.py is there to catch.
SEPARATOR = "__"


class ModelVersionNotFound(Exception):
    """A version requested via the A/B header doesn't exist in the MLflow registry."""


class ModelNotFoundForTenant(Exception):
    """No model is promoted for this tenant.

    Distinct from a model still loading: answering with another tenant's model
    would be a plausible-looking probability computed for the wrong client, and
    nothing downstream could tell. An explicit error turns a silent wrong answer
    into an operational problem that has an owner.
    """


def registered_model_name(base_name: str, tenant_id: str) -> str:
    return f"{base_name}{SEPARATOR}{tenant_id}"


class ModelRegistry:
    """Resolves the `Production` pyfunc model for a given tenant, on demand.

    Nothing is loaded at startup: with one model per tenant, eager-loading
    would make the pod's readiness depend on every tenant having a promoted
    model. A pod being ready means "able to serve", not "found every model".

    Non-`Production` versions requested through the A/B header (see
    `service.py`) are cached the same way, keyed by version as well.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self._cache: dict[tuple[str, str], object] = {}

    def load(self) -> None:
        """Only points MLflow at the tracking server — see the class docstring
        for why no model is fetched here."""
        mlflow.set_tracking_uri(self.settings.mlflow_tracking_uri)

    def _resolve(self, base_name: str, tenant_id: str, version: str | None) -> object:
        name = registered_model_name(base_name, tenant_id)
        stage = version or "Production"
        cache_key = (name, stage)

        if cache_key not in self._cache:
            try:
                self._cache[cache_key] = mlflow.pyfunc.load_model(f"models:/{name}/{stage}")
            except Exception as exc:
                if version is not None:
                    raise ModelVersionNotFound(f"{name} version {version!r} not found") from exc
                raise ModelNotFoundForTenant(
                    f"no {base_name} model promoted for tenant {tenant_id!r}"
                ) from exc
        return self._cache[cache_key]

    def volume_model_for(self, tenant_id: str, version: str | None = None) -> object:
        return self._resolve(self.settings.volume_model_name, tenant_id, version)

    def breach_model_for(self, tenant_id: str, version: str | None = None) -> object:
        return self._resolve(self.settings.breach_model_name, tenant_id, version)
