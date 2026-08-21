import { z } from 'zod';

/**
 * Output contract — mirrors contracts/event-envelope.schema.json (draft-07).
 * The gateway authenticates and envelopes; it never interprets the body. The
 * origin's payload is preserved verbatim, opaque, as a JSON string — nothing
 * inside it is typed here (domain/acl/itsm.md#onde-a-tradução-acontece).
 */
export const eventEnvelopeSchema = z
  .object({
    event_id: z.uuid().meta({ description: 'Identity of the event, minted by the gateway' }),
    tenant_id: z
      .string()
      .min(1)
      .meta({ description: 'Assigned from the credential that signed the request' }),
    source: z
      .string()
      .min(1)
      .meta({ description: 'Origin system that reported the event, assigned by the route' }),
    intake: z
      .enum(['alert', 'monitor'])
      .meta({ description: 'Nature of the origin, assigned by the route' }),
    version: z.string().min(1).meta({ description: "This envelope's format version" }),
    received_at: z.iso.datetime().meta({ description: 'When the gateway accepted the event' }),
    payload: z.string().meta({ description: "The origin's body, verbatim, as a JSON string" }),
  })
  .strict()
  .meta({ id: 'EventEnvelope', description: 'The raw envelope published to the bus' });

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** The body a webhook route accepts: any JSON object, kept opaque. */
export const webhookBodySchema = z.record(z.string(), z.unknown()).meta({
  id: 'WebhookBody',
  description: "The origin's event, in its own vocabulary — preserved verbatim",
});

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
    tenant_id: z.string(),
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
