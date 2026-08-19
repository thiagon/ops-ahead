FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /uvx /bin/

WORKDIR /app

# uv's documented workspace pattern: install third-party deps from just the
# root lock/pyproject first, no per-member COPY list to maintain.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-workspace

# Now that the whole workspace is present, sync just this member for real.
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --package ops-ahead-ml-model-serving

FROM python:3.12-slim

# lightgbm's compiled extension links against libgomp (GNU OpenMP) at
# runtime — python:3.12-slim doesn't ship it, so import fails with
# "OSError: libgomp.so.1: cannot open shared object file" without this.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY apps/ml-model-serving/src/ ./src/

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/app/src"

CMD ["python", "-m", "main"]
