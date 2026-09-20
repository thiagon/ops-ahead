import json

from config_store import ConfigStore


class _FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakePaginator:
    def __init__(self, keys: list[str]) -> None:
        self._keys = keys

    def paginate(self, Bucket: str, Prefix: str):
        matching = [k for k in self._keys if k.startswith(Prefix)]
        yield {"Contents": [{"Key": k} for k in matching]}


class _FakeS3:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(self, Bucket, Key, Body):
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        return {"Body": _FakeBody(self.objects[Key])}

    def get_paginator(self, operation):
        return _FakePaginator(list(self.objects.keys()))


def test_save_mapping_writes_under_tenant_source_path():
    s3 = _FakeS3()
    store = ConfigStore(s3, "bucket")
    store.save_mapping("locaweb", "service_now", {"tenant_id": "locaweb", "source": "service_now"})
    assert "rules/mapping/locaweb/service_now.json" in s3.objects


def test_save_deadlines_writes_under_tenant_path():
    s3 = _FakeS3()
    store = ConfigStore(s3, "bucket")
    store.save_deadlines("locaweb", {"tenant_id": "locaweb", "deadlines": []})
    assert "rules/deadline/locaweb.json" in s3.objects


def test_save_replaces_prior_object_under_same_key():
    s3 = _FakeS3()
    store = ConfigStore(s3, "bucket")
    store.save_targets("locaweb", {"tenant_id": "locaweb", "targets": [{"achievement_pct": 90}]})
    store.save_targets("locaweb", {"tenant_id": "locaweb", "targets": [{"achievement_pct": 95}]})
    assert len(s3.objects) == 1
    record = json.loads(s3.objects["rules/target/locaweb.json"])
    assert record["targets"][0]["achievement_pct"] == 95


def test_load_all_returns_every_object_under_rules_prefix():
    s3 = _FakeS3()
    store = ConfigStore(s3, "bucket")
    store.save_mapping("locaweb", "service_now", {"tenant_id": "locaweb", "source": "service_now"})
    store.save_deadlines("locaweb", {"tenant_id": "locaweb"})
    store.save_targets("locaweb", {"tenant_id": "locaweb"})

    records = store.load_all()

    assert len(records) == 3
    keys = {key for key, _ in records}
    assert keys == {
        "rules/mapping/locaweb/service_now.json",
        "rules/deadline/locaweb.json",
        "rules/target/locaweb.json",
    }


def test_load_all_skips_malformed_object():
    s3 = _FakeS3()
    s3.objects["rules/deadline/broken.json"] = b"not json"
    store = ConfigStore(s3, "bucket")

    assert store.load_all() == []
