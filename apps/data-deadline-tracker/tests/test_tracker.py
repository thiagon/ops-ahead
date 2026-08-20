from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from deadlines import DeadlineTable
from models import IncidentAlertEvent
from tracker import OccurrenceTracker


class FakeClient:
    def __init__(self, rows: list[tuple]) -> None:
        self._rows = rows

    def execute(self, query: str, params: dict | None = None):
        return self._rows


def _deadlines(rows: list[tuple]) -> DeadlineTable:
    table = DeadlineTable()
    table.refresh(FakeClient(rows))
    return table


def _event(**overrides) -> IncidentAlertEvent:
    defaults = dict(
        tenant_id="locaweb",
        source="itsm",
        external_id="INC1",
        entity_id="host-a",
        opened_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        acknowledged_at=None,
        severity=2,
        status="open",
        parent_id=None,
        resolution_code=None,
    )
    defaults.update(overrides)
    return IncidentAlertEvent(**defaults)


OPENED_AT = datetime(2026, 1, 1, tzinfo=timezone.utc)


def test_check_emits_pct_25_after_a_quarter_of_the_deadline():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 400)]), abandoned_ratio=3.0)
    tracker.apply_event(_event(opened_at=OPENED_AT))

    milestones = tracker.check(OPENED_AT + timedelta(seconds=100))

    assert [m.kind for m in milestones] == ["pct_25"]
    assert milestones[0].consumed_ratio == pytest.approx(0.25)
    assert milestones[0].deadline_seconds == 400


def test_check_does_not_reemit_an_already_crossed_threshold():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 400)]), abandoned_ratio=3.0)
    tracker.apply_event(_event(opened_at=OPENED_AT))

    tracker.check(OPENED_AT + timedelta(seconds=100))
    milestones = tracker.check(OPENED_AT + timedelta(seconds=100))

    assert milestones == []


def test_check_emits_every_threshold_crossed_since_the_last_call_in_one_sweep():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 400)]), abandoned_ratio=3.0)
    tracker.apply_event(_event(opened_at=OPENED_AT))

    milestones = tracker.check(OPENED_AT + timedelta(seconds=400))

    assert [m.kind for m in milestones] == ["pct_25", "pct_50", "pct_75", "pct_100"]


def test_no_milestone_fires_past_pct_100_besides_abandoned():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 400)]), abandoned_ratio=3.0)
    tracker.apply_event(_event(opened_at=OPENED_AT))

    tracker.check(OPENED_AT + timedelta(seconds=400))
    milestones = tracker.check(OPENED_AT + timedelta(seconds=500))

    assert milestones == []


def test_abandoned_fires_once_past_its_ratio_after_pct_100():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 100)]), abandoned_ratio=3.0)
    tracker.apply_event(_event(opened_at=OPENED_AT))

    milestones = tracker.check(OPENED_AT + timedelta(seconds=350))

    assert [m.kind for m in milestones] == ["pct_25", "pct_50", "pct_75", "pct_100", "abandoned"]


def test_severity_change_recalculates_and_can_jump_straight_to_pct_100():
    # P3 deadline 400s, P1 deadline 100s — recategorizing to P1 at the
    # halfway point of P3 (200s elapsed) is already 2x past the new deadline
    # (breached, but not yet past the 3x abandoned_ratio).
    tracker = OccurrenceTracker(
        _deadlines([("locaweb", 3, 400), ("locaweb", 1, 100)]), abandoned_ratio=3.0
    )
    tracker.apply_event(_event(opened_at=OPENED_AT, severity=3))

    halfway = OPENED_AT + timedelta(seconds=200)
    first_pass = tracker.check(halfway)
    assert [m.kind for m in first_pass] == ["pct_25", "pct_50"]

    tracker.apply_event(_event(opened_at=OPENED_AT, severity=1))
    second_pass = tracker.check(halfway)

    assert [m.kind for m in second_pass] == ["pct_75", "pct_100"]


def test_resolved_before_a_milestone_never_generates_it():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 400)]), abandoned_ratio=3.0)
    tracker.apply_event(_event(opened_at=OPENED_AT))

    tracker.apply_event(_event(opened_at=OPENED_AT, status="resolved"))

    assert len(tracker) == 0
    assert tracker.check(OPENED_AT + timedelta(seconds=1000)) == []


def test_reconstruct_marks_already_crossed_thresholds_without_emitting_them():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 400)]), abandoned_ratio=3.0)
    # 60% consumed as of reconstruction — pct_25/pct_50 already happened
    # before this process started.
    rows = [("locaweb", "itsm", "INC1", "host-a", 2, OPENED_AT, None, 0.6)]

    tracker.reconstruct(FakeClient(rows))

    assert len(tracker) == 1
    still_60_percent = tracker.check(OPENED_AT + timedelta(seconds=240))
    assert still_60_percent == []

    now_75_percent = tracker.check(OPENED_AT + timedelta(seconds=300))
    assert [m.kind for m in now_75_percent] == ["pct_75"]


def test_reconstruct_replaces_whatever_was_tracked_before():
    tracker = OccurrenceTracker(_deadlines([("locaweb", 2, 400)]), abandoned_ratio=3.0)
    tracker.apply_event(_event(opened_at=OPENED_AT, external_id="stale-in-memory"))

    tracker.reconstruct(FakeClient([]))

    assert len(tracker) == 0
