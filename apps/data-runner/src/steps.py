from __future__ import annotations

import logging
import subprocess
import sys

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def run_transform() -> None:
    subprocess.run(["dbt", "run", "--profiles-dir", "/dbt"], check=True)


def run_quality(argv: list[str]) -> None:
    from src.runner import main as runner_main

    sys.argv = ["src.runner", *argv]
    runner_main()


# Shared by the CLI (`run <transform|quality>`, src/main.py) and the Kafka
# consume mode (src/trigger.py) — one place each step's actual command lives.
STEPS = {"transform": run_transform, "quality": run_quality}
