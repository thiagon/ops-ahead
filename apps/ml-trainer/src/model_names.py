from __future__ import annotations

# One model per tenant, so the registered name has to say which. Both sides of
# the boundary read this: ml-trainer registers under it, ml-model-serving
# resolves the model to serve from it. Keeping the rule in one place is what
# stops a rename here from silently making inference unable to find anything.
SEPARATOR = "__"


def registered_model_name(base_name: str, tenant_id: str) -> str:
    return f"{base_name}{SEPARATOR}{tenant_id}"
