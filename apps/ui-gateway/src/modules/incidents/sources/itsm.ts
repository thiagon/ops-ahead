import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type IncidentOpenedBy, type IncidentStatus, translate } from '../domain.ts';
import { type IncidentEvent, incidentEventSchema } from '../schema.ts';
import { normalizeToIsoUtc } from '../time.ts';

/**
 * The ACL for the Locaweb ITSM: its input contract, its dictionaries, and the
 * mapping onto the published event. Another origin means a sibling of this
 * file — the published contract and its consumers stay put (domain/acl/itsm.md).
 */

const STATUS: Record<string, IncidentStatus> = {
  'Sem Intervenção': 'no_intervention',
  'Encerrado Automaticamente': 'auto_closed',
  Encerrado: 'closed',
  'Aguardando Problema': 'awaiting_problem',
};

/**
 * `Monitoramento` means the monitoring stack raised it; `Manual` means support
 * typed it in — the observability gap the breach model reads as a signal.
 */
const OPENED_BY: Record<string, IncidentOpenedBy> = {
  Monitoramento: 'monitoring',
  Manual: 'manual',
};

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
    opened_by: z
      .string()
      .default('')
      .meta({ description: 'What opened the incident, as the ITSM words it' }),
    payload: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Every origin column, kept verbatim in payload_raw' }),
  })
  .meta({ id: 'ItsmWebhook', description: 'Incident as the ITSM posts it' });

export type ItsmWebhook = z.infer<typeof itsmWebhookSchema>;

/**
 * The result goes through incidentEventSchema so what leaves the gateway is
 * checked against the published contract, not merely shaped like it — a mapping
 * that drifts fails here instead of downstream in the consumer.
 */
export function toIncidentEvent(input: ItsmWebhook): IncidentEvent {
  return incidentEventSchema.parse({
    event_id: randomUUID(),
    source: input.source,
    received_at: new Date().toISOString(),
    opened_at: normalizeToIsoUtc(input.opened_at),
    severity: input.priority_code,
    entity_id: input.configuration_item,
    status: translate(STATUS, input.status, 'unknown'),
    opened_by: translate(OPENED_BY, input.opened_by, 'unknown'),
    payload_raw: JSON.stringify(input.payload),
  });
}
