from __future__ import annotations

import numpy as np
import pandas as pd

# What an entity's behaviour is described by. Category and product are
# deliberately absent: grouping by them would reproduce the mart's own key,
# and "this group is mostly product X" is only a finding if X was not an input.
BEHAVIOUR_FEATURES = [
    "incidents_per_active_day",
    "active_day_share",
    "severity_mean",
    "critical_share",
    "breach_rate",
    "duration_mean",
    "duration_spread",
    "weekend_share",
]


def build_entity_features(breakdown: pd.DataFrame, window_days: int) -> pd.DataFrame:
    """One row per entity, describing how it fails rather than what it is."""
    df = breakdown.copy()
    df["date"] = pd.to_datetime(df["date"])
    df["weight"] = df["incident_count"]

    grouped = df.groupby("entity_id")
    rows = []
    for entity_id, g in grouped:
        incidents = int(g["incident_count"].sum())
        active_days = int(g["date"].nunique())
        weights = g["incident_count"].to_numpy(dtype=float)
        severities = g["severity"].to_numpy(dtype=float)
        durations = g["avg_duration_seconds"].to_numpy(dtype=float)
        weekend = g["date"].dt.dayofweek.to_numpy() >= 5

        rows.append(
            {
                "entity_id": entity_id,
                "incident_count": incidents,
                "active_days": active_days,
                "incidents_per_active_day": incidents / active_days if active_days else 0.0,
                "active_day_share": active_days / window_days if window_days else 0.0,
                "severity_mean": float(np.average(severities, weights=weights)) if incidents else 0.0,
                "critical_share": float(weights[severities <= 2].sum() / incidents) if incidents else 0.0,
                "breach_rate": float(g["breached"].sum() / incidents) if incidents else 0.0,
                "duration_mean": float(np.average(durations, weights=weights)) if incidents else 0.0,
                "duration_spread": float(np.std(durations)) if len(durations) > 1 else 0.0,
                "weekend_share": float(weights[weekend].sum() / incidents) if incidents else 0.0,
                # Carried for reading the result, never for fitting it.
                "category": g["category"].mode().iat[0] if not g["category"].mode().empty else "",
                "product": g["product"].mode().iat[0] if not g["product"].mode().empty else "",
            }
        )

    return pd.DataFrame(rows)


def entities_with_history(features: pd.DataFrame, min_incidents: int) -> pd.DataFrame:
    """An entity described by a couple of incidents positions itself by
    chance, and clustering has no way of saying it does not know. Being left
    out is a result, not an omission."""
    return features.loc[features["incident_count"] >= min_incidents].reset_index(drop=True)
