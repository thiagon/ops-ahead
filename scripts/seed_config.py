#!/usr/bin/env python3
"""Registers the service_now source and publishes its rules end to end: the
mapping (field bindings + value dictionary), contractual deadlines, and KPI
targets, through the gateway's /sources and PUT /rules/* routes.

The mapping is the ServiceNow → domain half of notebooks/events_dataset.ipynb
(Locaweb CSV → ServiceNow Table API). Bindings name the Table API columns;
the dictionary translates ServiceNow state/priority/opened_by/close_code
into the domain vocabulary.

Proves the configuration path end to end: gateway publishes → Kafka
carries it live → data-ingest applies it and mirrors it into MinIO. Nothing
here reaches MinIO or ClickHouse directly — verification is a separate step
that reads the ClickHouse tables data-ingest wrote to.

    GATEWAY_TOKEN=... python scripts/seed_config.py \\
      --gateway-url http://gateway.204-168-208-210.sslip.io
"""

import argparse
import os

import httpx

TENANT = "locaweb"
SOURCE = "service_now"

MAPPING = {
    "intake": "alert",
    "version": "v1",
    # Paths and dictionaries follow notebooks/events_dataset.ipynb: the
    # ServiceNow Table API shape (GET /api/now/table/incident), not the
    # Locaweb CSV. The notebook is the Locaweb → ServiceNow half; this
    # mapping is the ServiceNow → domain half. The webhook stores the
    # origin body verbatim, so paths are the Table API column names.
    "bindings": {
        "external_id": "number",
        "opened_at": "opened_at",
        "severity": "priority",
        "status": "state",
        "title": "short_description",
        "resolved_at": "resolved_at",
        "closed_at": "closed_at",
        "entity_id": "cmdb_ci",
        "owner": "assignment_group",
        "reported_by": "opened_by",
        "parent_id": "parent_incident",
        "resolution_code": "close_code",
        "resolution_summary": "close_notes",
        "labels": [
            {"key": "product", "path": "u_product"},
            {"key": "category", "path": "category"},
            {"key": "subcategory", "path": "subcategory"},
        ],
    },
    "mappings": {
        # ServiceNow incident.state: 1 New, 2 In Progress, 3 On Hold,
        # 6 Resolved, 7 Closed, 8 Canceled. The notebook already folded
        # "Sem Intervenção" into state 7; the KPI meaning of that closing
        # travels in close_code, not here.
        "status": {
            "1": "open",
            "2": "in_progress",
            "3": "waiting",
            "6": "resolved",
            "7": "closed",
            "8": "canceled",
        },
        "severity": {str(code): str(code) for code in range(1, 6)},
        "reported_by": {
            "monitoring.system": "automatic",
            "itsm.operator": "manual",
        },
        "resolution_code": {
            "No Intervention Required": "no_intervention",
        },
    },
}

# P1/P2 ≤ 4h · P3 ≤ 12h · P4 ≤ 24h · P5 ≤ 96h (docs/context/data-dictionary.md).
DEADLINES = {
    "deadlines": [
        {"severity": 1, "seconds": 4 * 3600},
        {"severity": 2, "seconds": 4 * 3600},
        {"severity": 3, "seconds": 12 * 3600},
        {"severity": 4, "seconds": 24 * 3600},
        {"severity": 5, "seconds": 96 * 3600},
    ]
}

TARGETS = {
    "targets": [
        {"severities": [1, 2], "max_breaches": 5, "achievement_pct": 95.0},
        {"severities": [3], "max_breaches": 10, "achievement_pct": 90.0},
    ]
}


def seed(gateway_url: str, secret: str | None, token: str) -> None:
    # The gateway introspects this bearer as gateway-web. A token minted for
    # gateway-mcp comes back inactive and every route answers 401.
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(base_url=gateway_url, headers=headers, timeout=10) as client:
        # Registering is what makes the address answer at all; the rules below
        # are what lets data-ingest translate what arrives on it.
        body = {"intake": MAPPING["intake"]}
        if secret:
            body["secret"] = secret
        registered = client.put(f"/sources/{TENANT}/{SOURCE}", json=body)
        registered.raise_for_status()
        print(f"source: {registered.status_code} {registered.json()['source']}")
        print(f"  secret: {registered.json()['secret']}")

        mapping = client.put(f"/rules/mappings/{TENANT}/{SOURCE}", json=MAPPING)
        mapping.raise_for_status()
        print(f"mapping: {mapping.status_code} {mapping.json()}")

        deadlines = client.put(f"/rules/deadlines/{TENANT}", json=DEADLINES)
        deadlines.raise_for_status()
        print(f"deadlines: {deadlines.status_code} {deadlines.json()}")

        targets = client.put(f"/rules/targets/{TENANT}", json=TARGETS)
        targets.raise_for_status()
        print(f"targets: {targets.status_code} {targets.json()}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--gateway-url",
        default="http://gateway.204-168-208-210.sslip.io",
    )
    parser.add_argument("--secret", help="Leave it out to have the gateway mint one")
    parser.add_argument(
        "--token",
        default=os.environ.get("GATEWAY_TOKEN"),
        help="Access token issued to the gateway-web client",
    )
    args = parser.parse_args()
    if not args.token:
        parser.error("pass --token or set GATEWAY_TOKEN (a gateway-web access token)")
    seed(args.gateway_url, args.secret, args.token)


if __name__ == "__main__":
    main()
