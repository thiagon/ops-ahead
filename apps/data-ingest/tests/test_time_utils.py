import pytest

from time_utils import normalize_to_utc


def test_reads_a_naive_timestamp_as_utc():
    assert normalize_to_utc("2025-12-31 23:45:18").isoformat() == "2025-12-31T23:45:18+00:00"


def test_honors_an_explicit_offset_instead_of_shifting_it():
    assert normalize_to_utc("2026-01-01T00:45:18-03:00").isoformat() == "2026-01-01T03:45:18+00:00"


def test_rejects_a_timestamp_it_cannot_parse():
    with pytest.raises(ValueError, match="unparseable timestamp"):
        normalize_to_utc("yesterday")
