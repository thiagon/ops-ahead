#!/usr/bin/env python3
"""Mock producer: reads assets/incidents.csv and posts events to the gateway webhook."""

import argparse
import asyncio
import hmac
import json
import os
import time
from hashlib import sha256
from pathlib import Path

import httpx
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent

# assets/incidents.csv is the original Locaweb base and stays in Portuguese.
# This mock is the boundary: everything it posts to the gateway is English, so
# no part of the real system ever sees the original vocabulary.
COLUMN_NAMES = {
    "numero": "ticket_number",
    "prioridade_codigo": "priority_code",
    "prioridade_label": "priority_label",
    "produto": "product",
    "categoria": "category",
    "subcategoria": "subcategory",
    "grupo_designado": "assignment_group",
    "item_configuracao": "configuration_item",
    "aberto_em": "opened_at",
    "aberto_data": "opened_date",
    "aberto_hora": "opened_hour",
    "aberto_dia_semana": "opened_weekday",
    "aberto_semana_ano": "opened_week_of_year",
    "aberto_mes": "opened_month",
    "resolvido_em": "resolved_at",
    "encerrado_em": "closed_at",
    "duracao_segundos": "duration_seconds",
    "duracao_minutos": "duration_minutes",
    "duracao_horas": "duration_hours",
    "status": "status",
    "codigo_fechamento": "close_code",
    "solucao": "resolution",
    "aberto_por": "opened_by",
    "incidente_pai": "parent_incident",
    "tem_incidente_pai": "has_parent_incident",
    "descricao_resumida": "short_description",
    "entrou_kpi": "counted_in_kpi",
    "kpi_violado": "kpi_breached",
}


def _map_row(row: pd.Series, source: str) -> dict:
    # An empty cell is null on the wire: NaN would serialize as a bare NaN, which
    # is not JSON and the gateway refuses it.
    payload = {
        COLUMN_NAMES.get(str(k), str(k)): (None if pd.isna(v) else v)
        for k, v in row.to_dict().items()
    }
    return {
        "ticket_number": payload["ticket_number"],
        "source": source,
        "opened_at": payload["opened_at"],
        # The ACL reads the terminal timestamps off the envelope, not out of
        # `payload`: omitting them here makes silver infer the closing instant
        # from when the replay was ingested, and every historical duration
        # becomes the age of the replay.
        "resolved_at": payload.get("resolved_at"),
        "closed_at": payload.get("closed_at"),
        "priority_code": int(payload["priority_code"]),
        "configuration_item": payload.get("configuration_item") or "",
        "status": payload.get("status") or "",
        "opened_by": payload.get("opened_by") or "",
        "payload": payload,
    }


def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, sha256).hexdigest()


async def produce(args: argparse.Namespace) -> None:
    csv_path = REPO_ROOT / "assets" / "incidents.csv"
    df = pd.read_csv(csv_path, dtype=str).sort_values("aberto_em").reset_index(drop=True)

    if args.limit:
        df = df.head(args.limit)

    total = len(df)
    base_delay = 1.0 / args.speed if args.speed > 0 else 0

    # The gateway verifies the signature over the exact bytes it received, so
    # the body is serialized here and posted verbatim instead of via json=.
    secret = os.environ.get("HMAC_SECRET", "")

    async with httpx.AsyncClient(base_url=args.gateway_url, timeout=10) as client:
        for i, (_, row) in enumerate(df.iterrows()):
            body = json.dumps(_map_row(row, args.source)).encode()
            headers = {"content-type": "application/json"}
            if secret:
                headers["X-Signature"] = _sign(secret, body)

            resp = await client.post(f"/webhook/{args.tenant}/{args.source}", content=body, headers=headers)
            resp.raise_for_status()

            if (i + 1) % 1000 == 0 or (i + 1) == total:
                print(f"posted {i + 1}/{total}", flush=True)

            if base_delay:
                await asyncio.sleep(base_delay)


def main() -> None:
    parser = argparse.ArgumentParser(description="Post incidents.csv rows to the gateway webhook")
    parser.add_argument("--gateway-url", default="http://localhost:8080")
    parser.add_argument("--tenant", default="locaweb")
    parser.add_argument("--source", default="itsm")
    parser.add_argument("--speed", type=float, default=0,
                        help="Events per second (0 = as fast as possible)")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max events to post (0 = all)")
    args = parser.parse_args()

    start = time.monotonic()
    asyncio.run(produce(args))
    elapsed = time.monotonic() - start
    print(f"done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
