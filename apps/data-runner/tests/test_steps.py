from __future__ import annotations

import sys

import pytest

import steps


def _fake_runner(exit_code: int | None):
    def _main() -> None:
        if exit_code is not None:
            sys.exit(exit_code)

    return _main


@pytest.fixture
def fake_runner_module(monkeypatch):
    """`run_quality` imports `runner` inside the function, so the fake has to
    live in sys.modules rather than be passed in."""
    import types

    def _install(exit_code: int | None):
        module = types.ModuleType("runner")
        module.main = _fake_runner(exit_code)
        monkeypatch.setitem(sys.modules, "runner", module)

    return _install


def test_a_reproved_suite_raises_instead_of_exiting(fake_runner_module):
    """The consumer catches Exception; a SystemExit would pass through it and
    end the process with the message still uncommitted."""
    fake_runner_module(1)

    with pytest.raises(RuntimeError, match="quality suite failed"):
        steps.run_quality(["--suite", "critical"])


def test_a_passing_suite_returns(fake_runner_module):
    fake_runner_module(None)

    steps.run_quality(["--suite", "critical"])


def test_an_explicit_zero_exit_is_not_a_failure(fake_runner_module):
    fake_runner_module(0)

    steps.run_quality(["--suite", "critical"])


class _FakeClient:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, sql: str) -> None:
        self.statements.append(sql)


def test_merge_bronze_forces_a_merge_on_both_bronze_tables(monkeypatch):
    """Without this the suites read whatever parts happened to be merged, so a
    retried insert shows up as a second row for one event."""
    import types

    client = _FakeClient()
    module = types.ModuleType("clickhouse_driver")
    module.Client = types.SimpleNamespace(from_url=lambda _url: client)
    monkeypatch.setitem(sys.modules, "clickhouse_driver", module)

    steps.merge_bronze()

    assert client.statements == [
        "OPTIMIZE TABLE bronze_alert FINAL",
        "OPTIMIZE TABLE bronze_monitor FINAL",
    ]


def test_transform_merges_before_building(monkeypatch):
    """dbt reads bronze, so the merge has to be done by the time it runs."""
    order: list[str] = []
    monkeypatch.setattr(steps, "merge_bronze", lambda: order.append("merge"))
    monkeypatch.setattr(steps, "run_build", lambda: order.append("build"))
    monkeypatch.setattr(
        "redis_snapshot.publish_snapshot", lambda _settings: order.append("snapshot")
    )

    steps.run_transform()

    assert order == ["merge", "build", "snapshot"]
