import { randomUUID } from 'node:crypto';
import type { EventPublisher } from '../../lib/kafka.ts';
import { EventsPublish, type EventsTopics } from './publish.ts';
import { type EventEnvelope, eventEnvelopeSchema, type WebhookAccepted } from './schema.ts';

/**
 * Who sent the event and which mapping version to translate it by. The
 * origin's secret has no place here — it authenticated the request and stops
 * at the hook (plugins/hmac.ts).
 */
export interface EventOrigin {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  version: string;
}

/**
 * Build the raw envelope for a body the route already authenticated. Nothing
 * here reads a field out of `body` beyond serializing it verbatim: tenant_id,
 * source, and intake all come from the origin that signed the request, never
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

export class EventsService {
  #publish: EventsPublish;

  constructor(publish: EventPublisher, topics: EventsTopics) {
    this.#publish = new EventsPublish(publish, topics);
  }

  async ingest(origin: EventOrigin, body: Record<string, unknown>): Promise<WebhookAccepted> {
    const envelope = buildEnvelope(origin, body);
    await this.#publish.send(envelope);
    return {
      event_id: envelope.event_id,
      tenant_id: envelope.tenant_id,
      source: envelope.source,
    };
  }
}
