import argparse
import json
import logging
import pathlib
import sys
import tempfile

import boto3

from .context import build_context
from .settings import Settings
from .suites import REGISTRY

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _upload_data_docs(context, settings: Settings) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        # Ephemeral contexts have no Data Docs site by default; wire one at `tmp`.
        context.add_data_docs_site(
            site_name="local",
            site_config={
                "class_name": "SiteBuilder",
                "store_backend": {
                    "class_name": "TupleFilesystemStoreBackend",
                    "base_directory": tmp,
                },
                "site_index_builder": {"class_name": "DefaultSiteIndexBuilder"},
            },
        )
        context.build_data_docs(site_names=["local"], dry_run=False)
        docs_dir = pathlib.Path(tmp)
        s3 = boto3.client(
            "s3",
            endpoint_url=settings.minio_endpoint,
            aws_access_key_id=settings.minio_access_key,
            aws_secret_access_key=settings.minio_secret_key,
        )
        for path in docs_dir.rglob("*"):
            if path.is_file():
                key = f"ge-docs/{path.relative_to(docs_dir)}"
                s3.upload_file(str(path), settings.minio_bucket, key)
                logger.info("uploaded %s", key)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", required=True, choices=list(REGISTRY), help="Suite to run")
    parser.add_argument("--upload-docs", action="store_true", help="Upload Data Docs to MinIO")
    args = parser.parse_args()

    settings = Settings()
    context = build_context(settings)

    register_fn = REGISTRY[args.suite]
    validation_def = register_fn(context)

    logger.info("running suite: %s", args.suite)
    result = validation_def.run()

    print(json.dumps(result.describe_dict(), indent=2))

    if args.upload_docs:
        try:
            _upload_data_docs(context, settings)
        except Exception:
            logger.warning("failed to upload data docs", exc_info=True)

    if not result.success:
        logger.error("suite %s FAILED", args.suite)
        sys.exit(1)

    logger.info("suite %s passed", args.suite)


if __name__ == "__main__":
    main()
