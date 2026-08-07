from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class TemporalSplit:
    train: pd.DataFrame
    validation: pd.DataFrame
    holdout: pd.DataFrame


def temporal_split(
    df: pd.DataFrame,
    date_column: str,
    train_end: str,
    validation_end: str,
    holdout_end: str,
) -> TemporalSplit:
    """Split a time-ordered dataset into train/validation/holdout by date boundaries.

    Boundaries are inclusive of their upper bound: train covers everything up to
    and including `train_end`, validation the days after `train_end` through
    `validation_end`, holdout the days after that through `holdout_end`. A plain
    random split would leak future rows into training given this dataset's
    strong weekly/seasonal signal — every caller must go through this function
    instead of slicing inline.
    """
    dates = pd.to_datetime(df[date_column])
    train_end_ts = pd.Timestamp(train_end)
    validation_end_ts = pd.Timestamp(validation_end)
    holdout_end_ts = pd.Timestamp(holdout_end)

    train = df.loc[dates <= train_end_ts]
    validation = df.loc[(dates > train_end_ts) & (dates <= validation_end_ts)]
    holdout = df.loc[(dates > validation_end_ts) & (dates <= holdout_end_ts)]

    return TemporalSplit(train=train, validation=validation, holdout=holdout)
