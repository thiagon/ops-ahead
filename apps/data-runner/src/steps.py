from __future__ import annotations

import logging
import subprocess
import sys

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def run_build() -> None:
    # dbt run materializes every view/table — including against empty bronze
    # data, which is exactly what a freshly bootstrapped cluster looks like
    # before its first trigger.data message, so this is safe to run standalone
    # as the chart's PreSync hook. The per-tenant configuration silver_alert
    # joins is a source table data-ingest materializes from config.deadline,
    # so nothing is seeded here.
    subprocess.run(["dbt", "run", "--profiles-dir", "/dbt"], check=True)


def run_transform() -> None:
    run_build()

    from redis_snapshot import publish_snapshot
    from settings import Settings

    publish_snapshot(Settings())


def run_quality(argv: list[str]) -> None:
    from runner import main as runner_main

    sys.argv = ["runner", *argv]
    runner_main()


# Shared by the CLI (`run <build|transform|quality>`, main.py), the
# Kafka consume mode (trigger.py) and the chart's PreSync Job — one place
# each step's actual command lives.
STEPS = {"build": run_build, "transform": run_transform, "quality": run_quality}
