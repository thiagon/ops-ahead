from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# domain/acl/itsm.md#o-dicionário-de-tradução — file name convention:
# dictionaries/<tenant_id>/<source>.<dictionary_version>.json, one dictionary
# per (tenant, source), matching contracts/translation-dictionary.schema.json.
_FILENAME = re.compile(r"^(?P<source>[^.]+)\.(?P<version>[^.]+)\.json$")


@dataclass(frozen=True)
class Dictionary:
    tenant_id: str
    source: str
    intake: str
    dictionary_version: str
    mappings: dict[str, dict[str, str]]

    def translate(self, field: str, raw: str | None, default: str | None = None) -> str | None:
        """A value outside the dictionary is the unknown case — it surfaces as
        `default`, it never fails the event (domain/acl/itsm.md)."""
        table = self.mappings.get(field, {})
        return table.get((raw or "").strip(), default)


class DictionaryRegistry:
    """Every dictionary this consumer knows, keyed by (tenant_id, source). Only
    the latest version of each is used for live translation — reprocessing
    picks an explicit version instead (see reprocess.py)."""

    def __init__(self, root: Path) -> None:
        self._root = root
        self._latest: dict[tuple[str, str], Dictionary] = {}
        self._by_version: dict[tuple[str, str, str], Dictionary] = {}
        self._load()

    def _load(self) -> None:
        if not self._root.is_dir():
            logger.warning("dictionaries directory not found: %s", self._root)
            return

        for tenant_dir in sorted(self._root.iterdir()):
            if not tenant_dir.is_dir():
                continue
            tenant_id = tenant_dir.name
            for path in sorted(tenant_dir.glob("*.json")):
                match = _FILENAME.match(path.name)
                if not match:
                    logger.warning("skipping dictionary with unexpected name: %s", path)
                    continue
                data = json.loads(path.read_text())
                dictionary = Dictionary(
                    tenant_id=data["tenant_id"],
                    source=data["source"],
                    intake=data["intake"],
                    dictionary_version=data["dictionary_version"],
                    mappings=data.get("mappings", {}),
                )
                if dictionary.tenant_id != tenant_id or dictionary.source != match.group("source"):
                    raise ValueError(f"dictionary content does not match its path: {path}")

                key = (dictionary.tenant_id, dictionary.source)
                self._by_version[(*key, dictionary.dictionary_version)] = dictionary
                # Versions sort lexicographically (v1, v2, …); the highest
                # sorts last, so later files in sorted order win as latest.
                self._latest[key] = dictionary

    def latest(self, tenant_id: str, source: str) -> Dictionary | None:
        return self._latest.get((tenant_id, source))

    def version(self, tenant_id: str, source: str, dictionary_version: str) -> Dictionary | None:
        return self._by_version.get((tenant_id, source, dictionary_version))
