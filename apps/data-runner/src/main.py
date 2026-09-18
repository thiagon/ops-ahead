from __future__ import annotations

import logging
import sys

from steps import STEPS

logging.basicConfig(level=logging.INFO)
LOGGER = logging.getLogger(__name__)


def main() -> None:
    if len(sys.argv) == 2 and sys.argv[1] == "consume":
        import metrics
        from settings import Settings
        from trigger import consume_forever

        settings = Settings()
        metrics.start(settings.metrics_port)
        consume_forever(settings)
        return

    if len(sys.argv) < 3 or sys.argv[1] != "run" or sys.argv[2] not in STEPS:
        LOGGER.error("Usage: python -m main run <build|transform|quality> [args...] | consume")
        sys.exit(2)

    step, extra_args = sys.argv[2], sys.argv[3:]
    if step == "quality":
        STEPS["quality"](extra_args)
    else:
        STEPS[step]()


if __name__ == "__main__":
    main()
