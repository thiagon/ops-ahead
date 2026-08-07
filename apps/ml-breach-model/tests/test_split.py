import pandas as pd
import pytest

from src.split import temporal_split


def _daily_frame(start: str, periods: int) -> pd.DataFrame:
    dates = pd.date_range(start, periods=periods, freq="D")
    return pd.DataFrame({"date": dates, "value": range(periods)})


def test_temporal_split_respects_boundaries():
    df = _daily_frame("2025-08-01", 200)  # runs through 2026-02-16

    result = temporal_split(
        df,
        date_column="date",
        train_end="2025-09-30",
        validation_end="2025-10-31",
        holdout_end="2026-01-31",
    )

    assert result.train["date"].max() <= pd.Timestamp("2025-09-30")
    assert result.validation["date"].min() > pd.Timestamp("2025-09-30")
    assert result.validation["date"].max() <= pd.Timestamp("2025-10-31")
    assert result.holdout["date"].min() > pd.Timestamp("2025-10-31")
    assert result.holdout["date"].max() <= pd.Timestamp("2026-01-31")


def test_temporal_split_has_no_overlap():
    df = _daily_frame("2025-01-01", 400)

    result = temporal_split(
        df,
        date_column="date",
        train_end="2025-09-30",
        validation_end="2025-10-31",
        holdout_end="2026-01-31",
    )

    train_dates = set(result.train["date"])
    validation_dates = set(result.validation["date"])
    holdout_dates = set(result.holdout["date"])

    assert train_dates.isdisjoint(validation_dates)
    assert train_dates.isdisjoint(holdout_dates)
    assert validation_dates.isdisjoint(holdout_dates)


def test_temporal_split_excludes_rows_after_holdout_end():
    df = _daily_frame("2025-08-01", 250)  # runs past 2026-01-31

    result = temporal_split(
        df,
        date_column="date",
        train_end="2025-09-30",
        validation_end="2025-10-31",
        holdout_end="2026-01-31",
    )

    total_rows = len(result.train) + len(result.validation) + len(result.holdout)
    assert total_rows < len(df)


def test_temporal_split_raises_on_empty_partition():
    # Every row falls in "train" — validation/holdout boundaries are past the
    # data's actual range, exactly the drift scenario the guard exists for.
    df = _daily_frame("2025-01-01", 30)

    with pytest.raises(ValueError, match="empty partition"):
        temporal_split(
            df,
            date_column="date",
            train_end="2025-09-30",
            validation_end="2025-10-31",
            holdout_end="2026-01-31",
        )
