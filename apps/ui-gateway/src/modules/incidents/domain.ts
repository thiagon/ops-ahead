import { z } from 'zod';

/**
 * The vocabulary the gateway publishes, shared by every origin. An origin's own
 * words never appear here — each adapter under `sources/` maps onto these
 * (domain/ubiquitous-language.md, domain/acl/itsm.md).
 */

export const incidentStatusSchema = z
  .enum(['no_intervention', 'auto_closed', 'closed', 'awaiting_problem', 'unknown'])
  .meta({ id: 'IncidentStatus', description: 'Incident status in the Ubiquitous Language' });

export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

export const incidentOpenedBySchema = z
  .enum(['monitoring', 'manual', 'unknown'])
  .meta({ id: 'IncidentOpenedBy', description: 'What opened the incident' });

export type IncidentOpenedBy = z.infer<typeof incidentOpenedBySchema>;

/**
 * A value the adapter's dictionary does not carry becomes `unknown` rather than
 * failing the event: an origin may add one at any time, and the verbatim value
 * stays in payload_raw for whoever extends the map.
 */
export function translate<T>(dictionary: Record<string, T>, raw: string | undefined, fallback: T): T {
  return dictionary[(raw ?? '').trim()] ?? fallback;
}
