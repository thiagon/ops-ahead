import { z } from 'zod';

/**
 * Output contract — mirrors contracts/incident-event.schema.json (draft-07).
 * Universal fields first-class; the origin event is preserved verbatim as a
 * JSON string in payload_raw. Strict, to match additionalProperties: false.
 */
export const incidentEventSchema = z
  .object({
    event_id: z.uuid(),
    source: z.string().min(1),
    received_at: z.iso.datetime(),
    opened_at: z.iso.datetime(),
    severity: z.int().min(1).max(5),
    entity_id: z.string(),
    status: z.string(),
    payload_raw: z.string(),
  })
  .strict();

export type IncidentEvent = z.infer<typeof incidentEventSchema>;

/**
 * Input contract for the ITSM source — the shape scripts/incident_producer.py
 * posts. `payload` carries the full set of origin columns and is kept verbatim.
 */
export const itsmWebhookSchema = z.object({
  ticket_number: z.string().min(1),
  source: z.string().min(1),
  opened_at: z.string().min(1),
  priority_code: z.coerce.number().int().min(1).max(5),
  configuration_item: z.string().default(''),
  status: z.string().default(''),
  payload: z.record(z.string(), z.unknown()),
});

export type ItsmWebhook = z.infer<typeof itsmWebhookSchema>;

/**
 * The body shape depends on the origin, so the route only pins down the field
 * it routes on and lets the resolved adapter validate the rest.
 */
export const webhookBodySchema = z.looseObject({
  source: z.string().min(1),
});

/** Envelope the route answers with once the event is accepted. */
export const webhookAcceptedSchema = z.object({
  event_id: z.uuid(),
  source: z.string(),
});

export const webhookErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
