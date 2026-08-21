from datetime import date

from reprocess import _daterange


def test_daterange_is_inclusive_of_both_ends():
    days = list(_daterange(date(2026, 1, 1), date(2026, 1, 3)))

    assert days == [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3)]


def test_daterange_single_day():
    assert list(_daterange(date(2026, 1, 1), date(2026, 1, 1))) == [date(2026, 1, 1)]
