from __future__ import annotations

import logging
import subprocess
import sys

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def run_transform() -> None:
    # Seeds first: silver_alert joins tenant_deadlines, which only exists
    # once seeded (domain/ubiquitous-language.md#tenant — deadline is
    # per-tenant config, not a code constant).
    subprocess.run(["dbt", "seed", "--profiles-dir", "/dbt"], check=True)
    subprocess.run(["dbt", "run", "--profiles-dir", "/dbt"], check=True)

    from redis_snapshot import publish_snapshot
    from settings import Settings

    publish_snapshot(Settings())


def run_quality(argv: list[str]) -> None:
    from runner import main as runner_main

    sys.argv = ["runner", *argv]
    runner_main()


# Shared by the CLI (`run <transform|quality>`, main.py) and the Kafka
# consume mode (trigger.py) — one place each step's actual command lives.
STEPS = {"transform": run_transform, "quality": run_quality}
