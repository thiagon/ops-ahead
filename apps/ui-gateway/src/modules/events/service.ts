import { randomUUID } from 'node:crypto';
import { type EventEnvelope, eventEnvelopeSchema } from './schema.ts';

/** Who sent the event, as the address it was posted to declares it. */
export interface EventOrigin {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  version: string;
}

/**
 * Build the raw envelope for a body the route already authenticated. Nothing
 * here reads a field out of `body` beyond serializing it verbatim: tenant_id,
 * source, and intake all come from the address the event was posted to, never
 * from the payload (domain/ubiquitous-language.md#source, #tenant, #intake).
 */
export function buildEnvelope(origin: EventOrigin, body: Record<string, unknown>): EventEnvelope {
  return eventEnvelopeSchema.parse({
    event_id: randomUUID(),
    tenant_id: origin.tenantId,
    source: origin.source,
    intake: origin.intake,
    version: origin.version,
    received_at: new Date().toISOString(),
    payload: JSON.stringify(body),
  });
}
