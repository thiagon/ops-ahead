import io
import json
import logging
from datetime import UTC, datetime

import boto3
import pyarrow as pa
import pyarrow.parquet as pq
from clickhouse_driver import Client

from .models import IncidentRaw
from .settings import Settings

logger = logging.getLogger(__name__)

_CLICKHOUSE_INSERT = """
    INSERT INTO incidents_raw
    (event_id, source, received_at, opened_at, severity, entity_id, status, payload_raw)
    VALUES
"""


def _clickhouse_row(evt: IncidentRaw) -> tuple:
    return (
        str(evt.event_id),
        evt.source,
        evt.received_at.astimezone(UTC).replace(tzinfo=None),
        evt.opened_at.astimezone(UTC).replace(tzinfo=None),
        evt.severity,
        evt.entity_id,
        evt.status,
        evt.payload_raw,
    )


def _minio_key(evt: IncidentRaw) -> str:
    date = evt.opened_at.astimezone(UTC).date()
    return f"raw/source={evt.source}/date={date}/"


class BatchWriter:
    def __init__(self, settings: Settings) -> None:
        self._ch = Client(
            host=settings.clickhouse_host,
            port=settings.clickhouse_port,
            database=settings.clickhouse_database,
            user=settings.clickhouse_user,
            password=settings.clickhouse_password,
        )
        self._s3 = boto3.client(
            "s3",
            endpoint_url=settings.minio_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
        )
        self._bucket = settings.minio_bucket

    async def write(self, batch: list[IncidentRaw]) -> None:
        self._write_clickhouse(batch)
        self._write_parquet(batch)

    def _write_clickhouse(self, batch: list[IncidentRaw]) -> None:
        rows = [_clickhouse_row(e) for e in batch]
        self._ch.execute(_CLICKHOUSE_INSERT, rows)
        logger.info("clickhouse: inserted %d rows", len(rows))

    def _write_parquet(self, batch: list[IncidentRaw]) -> None:
        # group by (source, date) to produce one Parquet file per partition key
        groups: dict[str, list[IncidentRaw]] = {}
        for evt in batch:
            key = _minio_key(evt)
            groups.setdefault(key, []).append(evt)

        for prefix, events in groups.items():
            table = pa.Table.from_pylist(
                [json.loads(e.model_dump_json()) for e in events]
            )
            buf = io.BytesIO()
            pq.write_table(table, buf)
            buf.seek(0)
            ts = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
            object_key = f"{prefix}{ts}.parquet"
            self._s3.put_object(Bucket=self._bucket, Key=object_key, Body=buf)
            logger.info("minio: wrote %s (%d events)", object_key, len(events))
