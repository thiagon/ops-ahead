#!/usr/bin/env python3
"""Publishes the service_now rules end to end: the origin mapping (field
bindings + value dictionary), contractual deadlines, and KPI targets, all
through the gateway's PUT /rules/* routes.

Proves the path spec-config-producao.md describes: gateway publishes → Kafka
carries it live → data-ingest applies it and mirrors it into MinIO. Nothing
here reaches MinIO or ClickHouse directly — verification is a separate step
that reads the ClickHouse tables data-ingest wrote to
(docs/spec-config-producao.md#semear-e-verificar).

    python -m seed_config --gateway-url http://localhost:8080
"""

import argparse

import httpx

TENANT = "locaweb"
SOURCE = "service_now"

MAPPING = {
    "intake": "alert",
    "dictionary_version": "v1",
    "bindings": [
        {"field": "external_id", "path": "number"},
        {"field": "status", "path": "fields.status.name"},
        {"field": "severity", "path": "fields.priority.name"},
        {"field": "opened_at", "path": "fields.opened_at"},
        {"field": "resolved_at", "path": "fields.resolved_at"},
        {"field": "closed_at", "path": "fields.closed_at"},
        {"field": "title", "path": "fields.short_description"},
        {"field": "reported_by", "path": "fields.opened_by"},
        {"field": "resolution_code", "path": "fields.close_code"},
    ],
    "mappings": {
        "status": {
            "Aberto": "open",
            "Em Andamento": "in_progress",
            "Em Espera": "waiting",
            "Resolvido": "resolved",
            "Encerrado": "closed",
            "Cancelado": "canceled",
        },
        "severity": {
            "1 - Crítica": "1",
            "2 - Alta": "2",
            "3 - Média": "3",
            "4 - Baixa": "4",
            "5 - Muito Baixa": "5",
        },
        "reported_by": {
            "Monitoramento": "automatic",
            "Cliente": "manual",
        },
        "resolution_code": {
            "Sem Intervenção": "no_intervention",
        },
    },
}

# P1/P2 ≤ 4h · P3 ≤ 12h · P4 ≤ 24h · P5 ≤ 96h (docs/context/data-dictionary.md).
DEADLINES = {
    "deadlines": [
        {"severity": 1, "deadline_seconds": 4 * 3600},
        {"severity": 2, "deadline_seconds": 4 * 3600},
        {"severity": 3, "deadline_seconds": 12 * 3600},
        {"severity": 4, "deadline_seconds": 24 * 3600},
        {"severity": 5, "deadline_seconds": 96 * 3600},
    ]
}

TARGETS = {
    "targets": [
        {"severities": [1, 2], "max_breaches": 5, "achievement_pct": 95.0},
        {"severities": [3], "max_breaches": 10, "achievement_pct": 90.0},
    ]
}


def seed(gateway_url: str) -> None:
    with httpx.Client(base_url=gateway_url, timeout=10) as client:
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
    args = parser.parse_args()
    seed(args.gateway_url)


if __name__ == "__main__":
    main()
