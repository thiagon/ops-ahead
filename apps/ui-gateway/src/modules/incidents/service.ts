import { randomUUID } from 'node:crypto';
import { type IncidentEnvelope, incidentEnvelopeSchema } from './schema.ts';
import type { OriginCredential } from './sources/registry.ts';

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
): IncidentEnvelope {
  return incidentEnvelopeSchema.parse({
    event_id: randomUUID(),
    tenant_id: credential.tenantId,
    source: credential.source,
    intake: credential.intake,
    version: credential.envelopeVersion,
    received_at: new Date().toISOString(),
    payload: JSON.stringify(body),
  });
}
