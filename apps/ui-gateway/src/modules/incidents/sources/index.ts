import { z } from 'zod';
import type { IncidentEvent } from '../schema.ts';
import { type ItsmWebhook, itsmWebhookSchema, toIncidentEvent } from './itsm.ts';

/**
 * The origins the gateway speaks, one adapter each. Registering a new one is
 * adding its module here: the union gains a variant, the switch gains a case,
 * and nothing downstream of the published event changes.
 */
export const webhookBodySchema = z
  .discriminatedUnion('source', [itsmWebhookSchema])
  .meta({ id: 'IncidentWebhook', description: 'Incident as its origin system posts it' });

export type WebhookBody = z.output<typeof webhookBodySchema>;

/** Map a body the route already validated onto the universal event. */
export function normalizeWebhook(body: WebhookBody): IncidentEvent {
  switch (body.source) {
    case 'itsm':
      return toIncidentEvent(body satisfies ItsmWebhook);
  }
}
