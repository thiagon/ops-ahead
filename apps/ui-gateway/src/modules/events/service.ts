import { randomUUID } from 'node:crypto';
import type { OriginCredential } from '../../plugins/origin-registry.ts';
import { type EventEnvelope, eventEnvelopeSchema } from './schema.ts';

/**
 * Build the raw envelope for a body the route already authenticated. Nothing
 * here reads a field out of `body` beyond serializing it verbatim: tenant_id,
 * source, and intake all come from the credential that validated the
 * signature, never from the payload (domain/ubiquitous-language.md#source,
 * #tenant, #intake).
 */
export function buildEnvelope(
  credential: OriginCredential,
  body: Record<string, unknown>,
): EventEnvelope {
  return eventEnvelopeSchema.parse({
    event_id: randomUUID(),
    tenant_id: credential.tenantId,
    source: credential.source,
    intake: credential.intake,
    version: credential.envelopeVersion,
    received_at: new Date().toISOString(),
    payload: JSON.stringify(body),
  });
}
