#!/usr/bin/env python3
"""Mock producer: reads assets/incidents.csv and posts events to the gateway webhook."""

import argparse
import asyncio
import time
from pathlib import Path

import httpx
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent


def _map_row(row: pd.Series, source: str) -> dict:
    return {
        "incidente_id": row["numero"],
        "source": source,
        "aberto_em": row["aberto_em"],
        "prioridade_codigo": int(row["prioridade_codigo"]),
        "item_configuracao": row.get("item_configuracao") or "",
        "status": row.get("status") or "",
        "payload": row.to_dict(),
    }


async def produce(args: argparse.Namespace) -> None:
    csv_path = REPO_ROOT / "assets" / "incidents.csv"
    df = pd.read_csv(csv_path, dtype=str).sort_values("aberto_em").reset_index(drop=True)

    if args.limit:
        df = df.head(args.limit)

    total = len(df)
    base_delay = 1.0 / args.speed if args.speed > 0 else 0

    async with httpx.AsyncClient(base_url=args.gateway_url, timeout=10) as client:
        for i, (_, row) in enumerate(df.iterrows()):
            payload = _map_row(row, args.source)
            resp = await client.post("/webhook/incidents", json=payload)
            resp.raise_for_status()

            if (i + 1) % 1000 == 0 or (i + 1) == total:
                print(f"posted {i + 1}/{total}", flush=True)

            if base_delay:
                await asyncio.sleep(base_delay)


def main() -> None:
    parser = argparse.ArgumentParser(description="Post incidents.csv rows to the gateway webhook")
    parser.add_argument("--gateway-url", default="http://localhost:8080")
    parser.add_argument("--source", default="itsm-locaweb")
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
