from __future__ import annotations

from deadlines import DeadlineTable


class FakeClient:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def execute(self, query: str, params: dict | None = None):
        return self._rows


def test_get_returns_the_deadline_for_a_known_tenant_and_severity():
    table = DeadlineTable()
    table.refresh(FakeClient([("locaweb", 1, 14400), ("locaweb", 3, 43200)]))

    assert table.get("locaweb", 1) == 14400
    assert table.get("locaweb", 3) == 43200


def test_get_returns_none_for_an_unknown_tenant_or_severity():
    table = DeadlineTable()
    table.refresh(FakeClient([("locaweb", 1, 14400)]))

    assert table.get("locaweb", 2) is None
    assert table.get("other-tenant", 1) is None


def test_refresh_replaces_the_previous_table_entirely():
    table = DeadlineTable()
    table.refresh(FakeClient([("locaweb", 1, 14400)]))
    table.refresh(FakeClient([("locaweb", 1, 99999)]))

    assert table.get("locaweb", 1) == 99999
