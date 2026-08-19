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
    uv sync --locked --package ops-ahead-data-runner

FROM python:3.12-slim

# dbt looks up dbt_project.yml from cwd (no --project-dir passed by the
# WorkflowTemplate steps), so the dbt project root doubles as the image's
# WORKDIR — src/ lives alongside it, added to PYTHONPATH so `python -m main`
# resolves its modules without a `src.` prefix while cwd stays /dbt.
WORKDIR /dbt

COPY --from=builder /app/.venv /app/.venv
COPY apps/data-runner/ .

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONPATH="/dbt/src"

CMD ["python", "-m", "main"]
