FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir uv && uv pip install --system .

COPY src/ ./src/

ENTRYPOINT ["python", "-m", "src.runner"]
