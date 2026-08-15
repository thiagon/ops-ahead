from __future__ import annotations

import logging
import subprocess
import sys

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def _run_transform() -> None:
    subprocess.run(["dbt", "run", "--profiles-dir", "/dbt"], check=True)


def _run_quality(argv: list[str]) -> None:
    from src.runner import main as runner_main

    sys.argv = ["src.runner", *argv]
    runner_main()


STEPS = {"transform": _run_transform, "quality": _run_quality}


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] != "run" or sys.argv[2] not in STEPS:
        LOGGER.error("Usage: python -m src.main run <transform|quality> [args...]")
        sys.exit(2)

    step, extra_args = sys.argv[2], sys.argv[3:]
    if step == "transform":
        _run_transform()
    else:
        _run_quality(extra_args)


if __name__ == "__main__":
    main()
