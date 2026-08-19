import { z } from 'zod';
import { incidentOpenedBySchema, incidentStatusSchema } from './domain.ts';

/**
 * Output contract — mirrors contracts/incident-event.schema.json (draft-07).
 * Universal fields first-class; the origin event is preserved verbatim as a
 * JSON string in payload_raw. Strict, to match additionalProperties: false.
 */
export const incidentEventSchema = z
  .object({
    event_id: z.uuid().meta({ description: 'Identity of the event, minted by the gateway' }),
    source: z.string().min(1).meta({ description: 'Origin system that reported the incident' }),
    received_at: z.iso.datetime().meta({ description: 'When the gateway accepted the event' }),
    opened_at: z.iso.datetime().meta({ description: 'When the incident was opened, ISO 8601 UTC' }),
    severity: z.int().min(1).max(5).meta({ description: '1 critical … 5 very low' }),
    entity_id: z.string().meta({ description: 'Affected configuration item' }),
    status: incidentStatusSchema,
    opened_by: incidentOpenedBySchema,
    payload_raw: z.string().meta({ description: 'The origin event, verbatim, as a JSON string' }),
  })
  .strict()
  .meta({ id: 'IncidentEvent', description: 'The universal event published to the bus' });

export type IncidentEvent = z.infer<typeof incidentEventSchema>;

/** Signed-request header — required when HMAC_ENABLED=true, ignored otherwise. */
export const webhookHeadersSchema = z.object({
  'x-signature': z.string().optional().meta({
    description: 'HMAC-SHA256 of the raw body, hex-encoded: sha256=<hex>',
    example: 'sha256=5257c92764fd8f5216674eb56ffaf27e0f88a5eb5d9f1e2a9e831b16ef2f4b3c',
  }),
});

/** Envelope the route answers with once the event is accepted. */
export const webhookAcceptedSchema = z
  .object({
    event_id: z.uuid(),
    source: z.string(),
  })
  .meta({ id: 'WebhookAccepted', description: 'The bus owns the event now' });

export const webhookErrorSchema = z
  .object({
    error: z.string().meta({ description: 'Machine-readable error name' }),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: 'Which fields broke the contract, when the body was the problem' }),
  })
  .meta({ id: 'ErrorResponse' });
