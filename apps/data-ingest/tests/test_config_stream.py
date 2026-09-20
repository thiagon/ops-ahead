import json

from bindings import BindingRegistry
from config_store import ConfigStore
from config_stream import apply_deadline_rows, apply_target_rows, load_snapshot_from_store
from dictionaries import DictionaryRegistry


def _raw(record: dict) -> bytes:
    return json.dumps(record).encode("utf-8")


def test_apply_deadline_rows_one_row_per_severity():
    raw = _raw(
        {
            "tenant_id": "locaweb",
            "deadlines": [
                {"severity": 1, "deadline_seconds": 14400},
                {"severity": 2, "deadline_seconds": 14400},
            ],
        }
    )
    rows = apply_deadline_rows(None, raw)
    assert rows is not None
    assert [row[:3] for row in rows] == [("locaweb", 1, 14400), ("locaweb", 2, 14400)]


def test_apply_target_rows_keeps_severities_as_one_band_per_row():
    raw = _raw(
        {
            "tenant_id": "locaweb",
            "targets": [
                {"severities": [1, 2], "max_breaches": 5, "achievement_pct": 95.0},
                {"severities": [3], "max_breaches": 10, "achievement_pct": 90.0},
            ],
        }
    )
    rows = apply_target_rows(None, raw)
    assert rows is not None
    assert [row[:3] for row in rows] == [
        ("locaweb", [1, 2], 5),
        ("locaweb", [3], 10),
    ]


def test_apply_target_rows_returns_none_for_tombstone():
    assert apply_target_rows(None, None) is None


class _FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakePaginator:
    def __init__(self, keys: list[str]) -> None:
        self._keys = keys

    def paginate(self, Bucket: str, Prefix: str):
        yield {"Contents": [{"Key": k} for k in self._keys if k.startswith(Prefix)]}


class _FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(self, Bucket, Key, Body):
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        return {"Body": _FakeBody(self.objects[Key])}

    def get_paginator(self, operation):
        return _FakePaginator(list(self.objects.keys()))


def test_load_snapshot_from_store_populates_registries_and_rows():
    s3 = _FakeS3()
    store = ConfigStore(s3, "bucket")
    store.save_mapping(
        "locaweb",
        "service_now",
        {
            "tenant_id": "locaweb",
            "source": "service_now",
            "intake": "alert",
            "dictionary_version": "v1",
            "bindings": [{"field": "status", "path": "fields.status"}],
            "mappings": {},
        },
    )
    store.save_deadlines("locaweb", {"tenant_id": "locaweb", "deadlines": [{"severity": 1, "deadline_seconds": 14400}]})
    store.save_targets(
        "locaweb",
        {"tenant_id": "locaweb", "targets": [{"severities": [1, 2], "max_breaches": 5, "achievement_pct": 95.0}]},
    )

    bindings = BindingRegistry()
    dictionaries = DictionaryRegistry()
    snapshot = load_snapshot_from_store(store, bindings, dictionaries)

    assert bindings.get("locaweb", "service_now") is not None
    assert dictionaries.latest("locaweb", "service_now") is not None
    assert len(snapshot.deadline_rows) == 1
    assert len(snapshot.target_rows) == 1


def test_load_snapshot_from_store_empty_store_yields_empty_state():
    s3 = _FakeS3()
    store = ConfigStore(s3, "bucket")
    bindings = BindingRegistry()
    dictionaries = DictionaryRegistry()

    snapshot = load_snapshot_from_store(store, bindings, dictionaries)

    assert len(bindings) == 0
    assert len(dictionaries) == 0
    assert snapshot.deadline_rows == []
    assert snapshot.target_rows == []
