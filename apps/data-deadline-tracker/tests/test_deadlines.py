from __future__ import annotations

import json

from deadlines import DeadlineTable, apply_deadline


def _record(deadlines: list[tuple[int, int]], tenant_id: str = "locaweb") -> bytes:
    return json.dumps(
        {
            "tenant_id": tenant_id,
            "deadlines": [
                {"severity": severity, "seconds": seconds}
                for severity, seconds in deadlines
            ],
        }
    ).encode()


def test_get_returns_the_deadline_for_a_known_tenant_and_severity():
    table = DeadlineTable()
    apply_deadline(table, "locaweb", _record([(1, 14400), (3, 43200)]))

    assert table.get("locaweb", 1) == 14400
    assert table.get("locaweb", 3) == 43200


def test_get_returns_none_for_an_unknown_tenant_or_severity():
    table = DeadlineTable()
    apply_deadline(table, "locaweb", _record([(1, 14400)]))

    assert table.get("locaweb", 2) is None
    assert table.get("other-tenant", 1) is None


def test_a_record_replaces_that_tenants_previous_set():
    table = DeadlineTable()
    apply_deadline(table, "locaweb", _record([(1, 14400), (3, 43200)]))
    apply_deadline(table, "locaweb", _record([(1, 99999)]))

    assert table.get("locaweb", 1) == 99999
    # Severity 3 was dropped upstream, so it must stop having a deadline here.
    assert table.get("locaweb", 3) is None


def test_a_record_leaves_another_tenant_untouched():
    table = DeadlineTable()
    apply_deadline(table, "locaweb", _record([(1, 14400)]))
    apply_deadline(table, "outro", _record([(1, 60)], tenant_id="outro"))

    assert table.get("locaweb", 1) == 14400
    assert table.get("outro", 1) == 60


def test_a_tombstone_forgets_the_tenant():
    table = DeadlineTable()
    apply_deadline(table, "locaweb", _record([(1, 14400)]))

    apply_deadline(table, "locaweb", None)

    assert table.get("locaweb", 1) is None


def test_a_malformed_record_is_skipped_rather_than_dropping_the_deadlines():
    table = DeadlineTable()
    apply_deadline(table, "locaweb", _record([(1, 14400)]))

    apply_deadline(table, "locaweb", b"not json")
    apply_deadline(table, "locaweb", json.dumps({"tenant_id": "locaweb"}).encode())

    assert table.get("locaweb", 1) == 14400
