const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Normalize an origin timestamp to ISO 8601 UTC. Origins that emit naive local
 * timestamps ("2025-12-31 23:45:18", no offset) have them read as UTC so the
 * result is deterministic wherever the gateway runs. Inputs that already carry
 * a Z or ±HH:MM offset are honored.
 */
export function normalizeToIsoUtc(raw: string): string {
  const trimmed = raw.trim();
  const candidate = NAIVE_TIMESTAMP.test(trimmed) ? `${trimmed.replace(' ', 'T')}Z` : trimmed;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`unparseable timestamp: ${raw}`);
  }
  return date.toISOString();
}
