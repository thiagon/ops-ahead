import pandas as pd

from src.volume.data import dataset_version


def test_dataset_version_is_deterministic():
    df = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=5), "total_incidents": [1, 2, 3, 4, 5]})

    assert dataset_version(df) == dataset_version(df.copy())


def test_dataset_version_changes_with_data():
    df1 = pd.DataFrame({"date": pd.date_range("2025-01-01", periods=5), "total_incidents": [1, 2, 3, 4, 5]})
    df2 = df1.copy()
    df2.loc[0, "total_incidents"] = 99

    assert dataset_version(df1) != dataset_version(df2)
