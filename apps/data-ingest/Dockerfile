FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

WORKDIR /app

# Workspace metadata for every member so uv can load the workspace graph,
# then install only ops-ahead-data-ingest's dependencies (member code is copied
# into the runtime stage, not installed — hence --no-install-workspace).
COPY pyproject.toml uv.lock ./
COPY scripts/pyproject.toml scripts/
COPY apps/data-ingest/pyproject.toml apps/data-ingest/
COPY apps/data-quality/pyproject.toml apps/data-quality/
COPY apps/data-transform/pyproject.toml apps/data-transform/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-workspace --package ops-ahead-data-ingest

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY apps/data-ingest/src/ ./src/
COPY apps/data-ingest/migrations/ ./migrations/

ENV PATH="/app/.venv/bin:$PATH"

CMD ["python", "-m", "src.main"]
