"""Reader for the Locaweb historical base — the one place offline analysis
touches the origin's vocabulary.

`assets/incidents.csv` keeps the ITSM's own column names and status words. The
ACL (domain/acl/itsm.md) confines that vocabulary to the historical base and
whatever reads it; everything downstream speaks the Ubiquitous Language. Scripts
that replay the base offline read it through here so the translation happens
once, at the edge, exactly as the gateway does for live events.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[1]
DATASET = REPO_ROOT / "assets" / "incidents.csv"

COLUMNS = {
    "numero": "ticket_number",
    "aberto_em": "opened_at",
    "prioridade_codigo": "severity",
    "item_configuracao": "entity_id",
    "status": "status",
    "aberto_por": "opened_by",
    "grupo_designado": "assignment_group",
}

STATUS = {
    "Sem Intervenção": "no_intervention",
    "Encerrado Automaticamente": "auto_closed",
    "Encerrado": "closed",
    "Aguardando Problema": "awaiting_problem",
}

OPENED_BY = {"Manual": "manual"}


def load(usecols: list[str] | None = None, path: Path | None = None) -> pd.DataFrame:
    """Read the historical base and return it in the Ubiquitous Language.

    `usecols` names domain columns, not origin ones — the caller never has to
    know how the origin spells them.
    """
    origin_of = {domain: origin for origin, domain in COLUMNS.items()}
    origin_cols = [origin_of[c] for c in usecols] if usecols else list(COLUMNS)

    df = pd.read_csv(path or DATASET, usecols=origin_cols)
    df = df.rename(columns=COLUMNS)

    if "status" in df:
        df["status"] = df["status"].map(STATUS).fillna("unknown")
    if "opened_by" in df:
        df["opened_by"] = df["opened_by"].map(OPENED_BY).fillna("automatic")
    if "opened_at" in df:
        df["opened_at"] = pd.to_datetime(df["opened_at"])

    return df
