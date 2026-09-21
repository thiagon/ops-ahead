"""Configuration persisted in MinIO — the source of truth, not the Kafka
topic it arrives on. Dev's broker is ephemeral (data-kafka values-dev.yaml)
and loses its compacted log on every restart; MinIO survives that. The
gateway never writes here directly — this module is the only writer and the
only reader.

Append-only, same as the topics it mirrors: save replaces the object under a
key, nothing deletes one.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Protocol

logger = logging.getLogger(__name__)


class ObjectStore(Protocol):
    def put_object(self, Bucket: str, Key: str, Body: Any) -> Any: ...
    def get_object(self, Bucket: str, Key: str) -> Any: ...
    def get_paginator(self, operation: str) -> Any: ...


class ConfigStore:
    def __init__(self, s3: ObjectStore, bucket: str) -> None:
        self._s3 = s3
        self._bucket = bucket

    def save_mapping(self, tenant_id: str, source: str, record: dict[str, Any]) -> None:
        self._put(f"rules/mapping/{tenant_id}/{source}.json", record)

    def save_deadlines(self, tenant_id: str, record: dict[str, Any]) -> None:
        self._put(f"rules/deadline/{tenant_id}.json", record)

    def save_targets(self, tenant_id: str, record: dict[str, Any]) -> None:
        self._put(f"rules/target/{tenant_id}.json", record)

    def load_all(self) -> list[tuple[str, dict[str, Any]]]:
        """Every rule object under rules/, as (key, record) pairs. Blocking
        and exhaustive: the boot that calls this must have the whole set
        before it subscribes to anything, or a translated event could hit a
        registry that is still missing a piece it has on disk."""
        records: list[tuple[str, dict[str, Any]]] = []
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix="rules/"):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                body = self._s3.get_object(Bucket=self._bucket, Key=key)["Body"].read()
                try:
                    record = json.loads(body)
                except json.JSONDecodeError:
                    logger.warning("config_store: %s is not valid json, skipping", key)
                    continue
                if isinstance(record, dict):
                    records.append((key, record))
        return records

    def _put(self, key: str, record: dict[str, Any]) -> None:
        self._s3.put_object(Bucket=self._bucket, Key=key, Body=json.dumps(record).encode("utf-8"))
        logger.info("config_store: wrote %s", key)
