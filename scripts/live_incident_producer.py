#!/usr/bin/env python3
"""Mock producer: posts still-open occurrences to the gateway webhook so the
operator queue (silver_alert_open) has something to show — nothing in the
environment otherwise publishes an incident that hasn't already closed.

Not a data source: this is test material for the ui-frontend screens
(consumed_ratio bands, breach, severity transition, unacknowledged), the same
role scripts/incident_producer.py plays for the closed-incident dataset.
"""

import argparse
import asyncio
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from hashlib import sha256

import httpx

# P1/P2 <= 4h, P3 <= 12h, P4 <= 24h, P5 <= 96h (docs/context/data-dictionary.md).
DEADLINE_SECONDS = {1: 4 * 3600, 2: 4 * 3600, 3: 12 * 3600, 4: 24 * 3600, 5: 96 * 3600}


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, sha256).hexdigest()


def _opened_at(severity: int, consumed_ratio: float) -> str:
    elapsed = DEADLINE_SECONDS[severity] * consumed_ratio
    opened = datetime.now(timezone.utc) - timedelta(seconds=elapsed)
    return opened.strftime("%Y-%m-%d %H:%M:%S")


def _scenario(
    ticket_number: str,
    severity: int,
    consumed_ratio: float,
    *,
    configuration_item: str = "srv-live-01",
    assignment_group: str = "infra",
    opened_by: str = "monitor",
    short_description: str = "",
) -> dict:
    return {
        "ticket_number": ticket_number,
        "priority_code": severity,
        "configuration_item": configuration_item,
        "assignment_group": assignment_group,
        "status": "in_progress",
        "opened_at": _opened_at(severity, consumed_ratio),
        "opened_by": opened_by,
        "resolved_at": None,
        "closed_at": None,
        "parent_incident": None,
        "short_description": short_description or f"Cenário de teste — {ticket_number}",
        "resolution": None,
        "product": "vps",
        "category": "rede",
        "subcategory": "latencia",
    }


def build_scenarios() -> list[dict]:
    """One occurrence per deadline-consumption band the screens need to
    exercise, plus overshoot and an unacknowledged one."""
    return [
        _scenario("LIVE-P1-LOW", severity=1, consumed_ratio=0.10, short_description="P1 recém aberta"),
        _scenario("LIVE-P2-MID", severity=2, consumed_ratio=0.50, short_description="P2 na metade do prazo"),
        _scenario("LIVE-P3-RISK", severity=3, consumed_ratio=0.80, short_description="P3 acima de 75% — risco alto"),
        _scenario("LIVE-P3-BREACHED", severity=3, consumed_ratio=1.20, short_description="P3 com prazo já estourado"),
        _scenario("LIVE-P4-QUIET", severity=4, consumed_ratio=0.05, short_description="P4 recém aberta, baixo risco"),
        _scenario("LIVE-P5-OLD", severity=5, consumed_ratio=0.60, short_description="P5 de baixa prioridade"),
        _scenario(
            "LIVE-P2-UNACK",
            severity=2,
            consumed_ratio=0.65,
            opened_by="manual",
            short_description="P2 aberta sem reconhecimento",
        ),
        # Same ticket at two severities — priority_changes_log detects the
        # transition from consecutive bronze_alert events, so the deadline the
        # screen shows is the recalculated one, not the original.
        _scenario("LIVE-RECAT", severity=4, consumed_ratio=0.30, short_description="Recategorizada — abertura"),
        _scenario("LIVE-RECAT", severity=2, consumed_ratio=0.20, short_description="Recategorizada — escalada a P2"),
    ]


async def produce(args: argparse.Namespace) -> None:
    secret = os.environ.get("HMAC_SECRET", "")

    async with httpx.AsyncClient(base_url=args.gateway_url, timeout=10) as client:
        for scenario in build_scenarios():
            body = json.dumps(scenario).encode()
            headers = {"content-type": "application/json"}
            if secret:
                headers["X-Signature"] = _sign(secret, body)

            resp = await client.post(f"/webhook/v1/locaweb/{args.source}", content=body, headers=headers)
            resp.raise_for_status()
            print(f"posted {scenario['ticket_number']}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Post still-open test occurrences to the gateway webhook")
    parser.add_argument("--gateway-url", default="http://localhost:8080")
    parser.add_argument("--source", default="itsm")
    args = parser.parse_args()

    asyncio.run(produce(args))


if __name__ == "__main__":
    main()
