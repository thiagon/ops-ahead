import { z } from 'zod';
import { incidentStatusSchema } from './status.ts';

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
    payload_raw: z.string().meta({ description: 'The origin event, verbatim, as a JSON string' }),
  })
  .strict()
  .meta({ id: 'IncidentEvent', description: 'The universal event published to the bus' });

export type IncidentEvent = z.infer<typeof incidentEventSchema>;

/**
 * Input contract for the ITSM source — the shape scripts/incident_producer.py
 * posts. `payload` carries the full set of origin columns and is kept verbatim.
 */
export const itsmWebhookSchema = z
  .object({
    source: z.literal('itsm'),
    ticket_number: z.string().min(1).meta({ description: 'Origin ticket number, e.g. INC0012345' }),
    opened_at: z.string().min(1).meta({
      description: 'Open datetime; a naive value is read as UTC',
      example: '2025-12-31 23:45:18',
    }),
    priority_code: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .meta({ description: '1 critical … 5 very low' }),
    configuration_item: z.string().default('').meta({ description: 'Affected configuration item' }),
    status: z.string().default('').meta({ description: 'Incident status as the ITSM words it' }),
    payload: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Every origin column, kept verbatim in payload_raw' }),
  })
  .meta({ id: 'ItsmWebhook', description: 'Incident as the ITSM posts it' });

export type ItsmWebhook = z.infer<typeof itsmWebhookSchema>;

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
