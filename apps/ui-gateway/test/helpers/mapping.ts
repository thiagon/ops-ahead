import type { Mapping } from '../../src/services/rules/schema.ts';

type AlertMapping = Extract<Mapping, { intake: 'alert' }>;
type MonitorMapping = Extract<Mapping, { intake: 'monitor' }>;

/** Required bronze_alert columns, plus the optionals this origin actually sends. */
export const alertMapping: AlertMapping = {
  intake: 'alert',
  version: 'v1',
  bindings: {
    external_id: 'payload.ticket_number',
    opened_at: 'payload.opened_at',
    severity: 'payload.priority_code',
    status: 'fields.status',
    title: 'payload.short_description',
    resolved_at: 'payload.resolved_at',
    closed_at: 'payload.closed_at',
    entity_id: 'payload.configuration_item',
    owner: 'payload.assignment_group',
    reported_by: 'payload.opened_by',
    parent_id: 'payload.parent_incident',
    resolution_code: 'payload.close_code',
  },
  mappings: { status: { Aberto: 'open' } },
};

/** Required bronze_monitor columns, plus the optionals this origin actually sends. */
export const monitorMapping: MonitorMapping = {
  intake: 'monitor',
  version: 'v1',
  bindings: {
    external_id: 'payload.alertname',
    started_at: 'payload.startsAt',
    condition: 'payload.status',
    entity_id: 'payload.instance',
    ended_at: 'payload.endsAt',
    severity: 'payload.severity',
    title: 'payload.summary',
    source_url: 'payload.generatorURL',
  },
  mappings: { condition: { firing: 'firing', resolved: 'cleared' } },
};
