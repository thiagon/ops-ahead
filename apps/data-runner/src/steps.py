from __future__ import annotations

import logging
import subprocess
import sys

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def run_structure() -> None:
    """The read models data-deadline-tracker selects from at boot, and nothing
    else. It is what the chart's PreSync hook needs: a deploy must not depend
    on the analytical marts computing, only on the objects a consumer queries
    existing. A broken mart then fails the run that computes it, never the
    deploy."""
    # `+` pulls in what the views select from (silver_alert), without which
    # they cannot be created at all.
    subprocess.run(
        ["dbt", "run", "--profiles-dir", "/dbt", "--select", "+config.materialized:view"],
        check=True,
    )


def run_build() -> None:
    # Materializes every view/table, including against empty bronze — a
    # freshly bootstrapped cluster before its first trigger.data message.
    # The per-tenant configuration silver_alert joins is a source table
    # data-ingest materializes from rules.deadline, so nothing is seeded here.
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
STEPS = {"structure": run_structure, "build": run_build, "transform": run_transform, "quality": run_quality}
