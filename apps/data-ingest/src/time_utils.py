import re
from datetime import UTC, datetime

_NAIVE_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$")


def normalize_to_utc(raw: str) -> datetime:
    """Normalize an origin timestamp to an aware UTC datetime. Origins that emit
    naive local timestamps ("2025-12-31 23:45:18", no offset) have them read as
    UTC so the result is deterministic wherever this runs. Inputs that already
    carry an offset are honored and converted."""
    trimmed = raw.strip()
    candidate = f"{trimmed.replace(' ', 'T')}+00:00" if _NAIVE_TIMESTAMP.match(trimmed) else trimmed
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ValueError(f"unparseable timestamp: {raw}") from exc
    return parsed.astimezone(UTC)
