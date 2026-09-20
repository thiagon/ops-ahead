#!/usr/bin/env python3
"""Registers the service_now source and publishes its rules end to end: the
mapping (field bindings + value dictionary), contractual deadlines, and KPI
targets, through the gateway's /sources and PUT /rules/* routes.

Proves the path spec-config-producao.md describes: gateway publishes → Kafka
carries it live → data-ingest applies it and mirrors it into MinIO. Nothing
here reaches MinIO or ClickHouse directly — verification is a separate step
that reads the ClickHouse tables data-ingest wrote to
(docs/spec-config-producao.md#semear-e-verificar).

    python -m seed_config --gateway-url http://localhost:8080 --secret ops-ahead-dev
"""

import argparse

import httpx

TENANT = "locaweb"
SOURCE = "service_now"

MAPPING = {
    "intake": "alert",
    "version": "v1",
    # Paths follow what scripts/incident_producer.py puts on the wire: the
    # untouched ITSM record under `payload`, already renamed to English.
    "bindings": [
        {"field": "external_id", "path": "payload.ticket_number"},
        {"field": "status", "path": "payload.status"},
        {"field": "severity", "path": "payload.priority_code"},
        {"field": "opened_at", "path": "payload.opened_at"},
        {"field": "resolved_at", "path": "payload.resolved_at"},
        {"field": "closed_at", "path": "payload.closed_at"},
        {"field": "title", "path": "payload.short_description"},
        {"field": "entity_id", "path": "payload.configuration_item"},
        {"field": "owner", "path": "payload.assignment_group"},
        {"field": "reported_by", "path": "payload.opened_by"},
        {"field": "parent_id", "path": "payload.parent_incident"},
        {"field": "resolution_code", "path": "payload.close_code"},
    ],
    "mappings": {
        # "Sem Intervenção" is a closing state in the ITSM, not a lifecycle of
        # its own — what it means for the KPI travels in resolution_code.
        "status": {
            "Sem Intervenção": "closed",
            "Encerrado Automaticamente": "closed",
            "Encerrado": "closed",
            "Aguardando Problema": "waiting",
        },
        # priority_code already travels as 1-5; the dictionary is identity so
        # the binding stays declarative instead of special-cased in code.
        "severity": {str(code): str(code) for code in range(1, 6)},
        "reported_by": {
            "Monitoramento": "automatic",
            "Manual": "manual",
        },
        # Only the codes the KPI rules care about are translated; the rest
        # reach bronze as they are.
        "resolution_code": {
            "Sem Intervenção": "no_intervention",
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


def seed(gateway_url: str, secret: str | None) -> None:
    with httpx.Client(base_url=gateway_url, timeout=10) as client:
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
    parser.add_argument("--gateway-url", default="http://localhost:8080")
    parser.add_argument("--secret", help="Leave it out to have the gateway mint one")
    args = parser.parse_args()
    seed(args.gateway_url, args.secret)


if __name__ == "__main__":
    main()
