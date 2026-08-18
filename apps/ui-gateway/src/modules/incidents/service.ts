import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type IncidentEvent,
  type ItsmWebhook,
  incidentEventSchema,
  itsmWebhookSchema,
} from './schema.ts';
import { toIncidentOpenedBy, toIncidentStatus } from './status.ts';

/** The origins the gateway speaks, one variant each. */
export const webhookBodySchema = z
  .discriminatedUnion('source', [itsmWebhookSchema])
  .meta({ id: 'IncidentWebhook', description: 'Incident as its origin system posts it' });

export type WebhookBody = z.output<typeof webhookBodySchema>;

const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/;

/**
 * Normalize an origin timestamp to ISO 8601 UTC. The ITSM dataset emits naive
 * local timestamps ("2025-12-31 23:45:18", no offset); those are read as UTC so
 * the result is deterministic wherever the gateway runs. Inputs that already
 * carry a Z or ±HH:MM offset are honored.
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

/**
 * Map a validated ITSM webhook onto the universal schema. The result goes
 * through incidentEventSchema so what leaves the gateway is checked against the
 * published contract, not merely shaped like it — a mapping that drifts fails
 * here instead of downstream in the consumer.
 */
export function toIncidentEvent(input: ItsmWebhook): IncidentEvent {
  return incidentEventSchema.parse({
    event_id: randomUUID(),
    source: input.source,
    received_at: new Date().toISOString(),
    opened_at: normalizeToIsoUtc(input.opened_at),
    severity: input.priority_code,
    entity_id: input.configuration_item,
    status: toIncidentStatus(input.status),
    opened_by: toIncidentOpenedBy(input.opened_by),
    payload_raw: JSON.stringify(input.payload),
  });
}

/** Map a body the route already validated onto the universal event. */
export function normalizeWebhook(body: WebhookBody): IncidentEvent {
  switch (body.source) {
    case 'itsm':
      return toIncidentEvent(body);
  }
}
