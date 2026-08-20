"""Reprocess a period of raw envelopes from the lake with a pinned dictionary
version. Appends new bronze rows — never deletes or overwrites what an
earlier translation already produced (domain/acl/itsm.md#reprocessamento):
a closed month's indicator does not change in silence.

    python -m reprocess --tenant locaweb --source itsm --intake alert \
        --date-from 2026-01-01 --date-to 2026-01-02 --dictionary-version v2
"""

from __future__ import annotations

import argparse
import io
import logging
from datetime import date, timedelta

import pyarrow.parquet as pq

import metrics
from dictionaries import DictionaryRegistry
from models import BronzeAlertEvent, IncidentEnvelope
from settings import Settings
from translate import UnknownSourceError
from translate import translate as translate_envelope
from writer import (
    _CLICKHOUSE_INSERT_ALERT,
    _CLICKHOUSE_INSERT_MONITOR,
    BatchWriter,
    _alert_row,
    _monitor_row,
)

logger = logging.getLogger(__name__)


def _daterange(date_from: date, date_to: date):
    day = date_from
    while day <= date_to:
        yield day
        day += timedelta(days=1)


class _NullPublisher:
    """Reprocessing writes bronze, it does not replay onto the live translated
    topic — a downstream consumer that already saw the original event would
    otherwise see it twice for one period."""

    async def publish(self, message: str, topic: str) -> None:
        return None


def _list_objects(s3, bucket: str, prefix: str) -> list[str]:
    paginator = s3.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def _read_envelopes(s3, bucket: str, key: str) -> list[IncidentEnvelope]:
    body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    table = pq.read_table(io.BytesIO(body))
    return [IncidentEnvelope.model_validate(row) for row in table.to_pylist()]


def reprocess(
    settings: Settings,
    tenant_id: str,
    source: str,
    intake: str,
    date_from: date,
    date_to: date,
    dictionary_version: str,
) -> int:
    writer = BatchWriter(settings, publisher=_NullPublisher())
    dictionaries = DictionaryRegistry(settings.dictionaries_dir)
    pinned = dictionaries.version(tenant_id, source, dictionary_version)
    if pinned is None:
        raise ValueError(f"no dictionary version {dictionary_version!r} for {tenant_id}/{source}")

    written = 0
    for day in _daterange(date_from, date_to):
        prefix = f"raw/tenant={tenant_id}/intake={intake}/source={source}/date={day.isoformat()}/"
        keys = _list_objects(writer._s3, settings.minio_bucket, prefix)
        logger.info("reprocess: %d object(s) under %s", len(keys), prefix)

        alert_rows = []
        monitor_rows = []
        for key in keys:
            for envelope in _read_envelopes(writer._s3, settings.minio_bucket, key):
                try:
                    bronze = translate_envelope(envelope, dictionaries, dictionary=pinned)
                except UnknownSourceError:
                    metrics.translation_failures.labels(source=source, intake=intake).inc()
                    continue

                if isinstance(bronze, BronzeAlertEvent):
                    alert_rows.append(_alert_row(bronze))
                else:
                    monitor_rows.append(_monitor_row(bronze))

        if alert_rows:
            writer._ch.execute(_CLICKHOUSE_INSERT_ALERT, alert_rows)
        if monitor_rows:
            writer._ch.execute(_CLICKHOUSE_INSERT_MONITOR, monitor_rows)
        written += len(alert_rows) + len(monitor_rows)

    return written


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--intake", required=True, choices=["alert", "monitor"])
    parser.add_argument("--date-from", required=True, type=date.fromisoformat)
    parser.add_argument("--date-to", required=True, type=date.fromisoformat)
    parser.add_argument("--dictionary-version", required=True)
    args = parser.parse_args()

    settings = Settings()
    written = reprocess(
        settings,
        tenant_id=args.tenant,
        source=args.source,
        intake=args.intake,
        date_from=args.date_from,
        date_to=args.date_to,
        dictionary_version=args.dictionary_version,
    )
    logger.info("reprocess: wrote %d bronze row(s)", written)


if __name__ == "__main__":
    main()
