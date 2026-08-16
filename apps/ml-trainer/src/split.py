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

    Shared by both the volume-forecast and breach-risk trainers — same boundary
    semantics, different downstream metric.
    """
    # ClickHouse DateTime64 columns come back tz-aware (UTC); Date columns come
    # back naive. Comparing a tz-aware Series against the naive Timestamps built
    # from the plain boundary strings raises TypeError, so tz info is dropped
    # here rather than carried through — the boundaries are calendar dates, not
    # instants, and every source in this dataset is already UTC.
    dates = pd.to_datetime(df[date_column])
    if dates.dt.tz is not None:
        dates = dates.dt.tz_localize(None)
    train_end_ts = pd.Timestamp(train_end)
    validation_end_ts = pd.Timestamp(validation_end)
    holdout_end_ts = pd.Timestamp(holdout_end)

    train = df.loc[dates <= train_end_ts]
    validation = df.loc[(dates > train_end_ts) & (dates <= validation_end_ts)]
    holdout = df.loc[(dates > validation_end_ts) & (dates <= holdout_end_ts)]

    split = TemporalSplit(train=train, validation=validation, holdout=holdout)
    _raise_if_any_partition_empty(split, train_end, validation_end, holdout_end)
    return split


def _raise_if_any_partition_empty(
    split: TemporalSplit, train_end: str, validation_end: str, holdout_end: str
) -> None:
    """The split boundaries come from the trigger.ml event for the run —
    if they don't match the data's actual date range (dataset swap, ingestion
    bug, wrong parameter), a partition can silently come back empty and every
    metric downstream goes quietly wrong (NaN MAPE/AUC-PR, a LightGBM fit on
    zero rows). Failing loudly here, at the one place all three boundaries are
    enforced, turns that into an immediate, readable error instead of a
    debugging hunt days later."""
    empty = [
        name
        for name, part in (("train", split.train), ("validation", split.validation), ("holdout", split.holdout))
        if part.empty
    ]
    if empty:
        raise ValueError(
            f"temporal_split produced empty partition(s) {empty} for boundaries "
            f"train_end={train_end!r} validation_end={validation_end!r} holdout_end={holdout_end!r} — "
            "the dataset's actual date range likely doesn't match these boundaries anymore."
        )
