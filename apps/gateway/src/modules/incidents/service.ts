import { randomUUID } from 'node:crypto';
import {
  type IncidentEvent,
  type ItsmWebhook,
  incidentEventSchema,
  itsmWebhookSchema,
} from './schema.ts';

export interface NormalizeIssue {
  path: string;
  message: string;
}

export type NormalizeResult =
  | { success: true; event: IncidentEvent }
  | { success: false; issues: NormalizeIssue[] };

/**
 * A source adapter owns the contract of one origin system: it validates the
 * incoming payload and normalizes it into the universal IncidentEvent. Adding a
 * source (alertmanager, datadog) means adding an adapter — nothing downstream
 * (consumer, marts) changes. The result shape keeps the origin's validation
 * vocabulary out of the route.
 */
export interface SourceAdapter {
  readonly source: string;
  normalize(input: unknown): NormalizeResult;
}

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
    status: input.status,
    payload_raw: JSON.stringify(input.payload),
  });
}

export const itsmAdapter: SourceAdapter = {
  source: 'itsm',

  normalize(input) {
    const parsed = itsmWebhookSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        issues: parsed.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      };
    }
    return { success: true, event: toIncidentEvent(parsed.data) };
  },
};

const registry = new Map<string, SourceAdapter>([[itsmAdapter.source, itsmAdapter]]);

/** Resolve the adapter for a source id, or undefined if none is registered. */
export function resolveAdapter(source: string): SourceAdapter | undefined {
  return registry.get(source);
}
