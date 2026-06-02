FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-workspace

FROM python:3.12-slim

WORKDIR /dbt

COPY --from=builder /app/.venv /app/.venv
COPY apps/data-transform/ .

ENV PATH="/app/.venv/bin:$PATH"
