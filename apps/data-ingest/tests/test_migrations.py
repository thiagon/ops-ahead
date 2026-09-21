from __future__ import annotations

import pathlib

import pytest

MIGRATIONS = sorted((pathlib.Path(__file__).resolve().parents[1] / "migrations").glob("*.sql"))


def _comment_lines(sql: str) -> list[tuple[int, str]]:
    return [
        (n, line)
        for n, line in enumerate(sql.splitlines(), start=1)
        if line.lstrip().startswith("--")
    ]


@pytest.mark.parametrize("path", MIGRATIONS, ids=lambda p: p.name)
def test_no_semicolon_inside_a_comment(path: pathlib.Path):
    """The runner splits a migration on `;` before parsing it, so one inside a
    comment cuts a statement in half and the leading piece reaches ClickHouse
    as a comment on its own — rejected as an empty query."""
    offenders = [(n, line) for n, line in _comment_lines(path.read_text()) if ";" in line]

    assert not offenders, f"{path.name}: {offenders}"
