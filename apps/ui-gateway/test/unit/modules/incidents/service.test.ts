import { describe, expect, it } from 'vitest';
import {
  normalizeToIsoUtc,
  normalizeWebhook,
  toIncidentEvent,
  webhookBodySchema,
} from '../../../../src/modules/incidents/service.ts';

// One row of assets/incidents.csv, as scripts/incident_producer.py posts it.
const itsmEvent = {
  ticket_number: 'INC0012345',
  source: 'itsm' as const,
  opened_at: '2025-12-31 23:45:18',
  priority_code: 2,
  configuration_item: 'srv-web-04',
  status: 'Encerrado',
  opened_by: 'Monitoramento',
  payload: { ticket_number: 'INC0012345', duration_seconds: '9120', kpi_breached: '1' },
};

describe('normalizeToIsoUtc', () => {
  it('reads a naive ITSM timestamp as UTC', () => {
    expect(normalizeToIsoUtc('2025-12-31 23:45:18')).toBe('2025-12-31T23:45:18.000Z');
  });

  it('honors an explicit offset instead of shifting it', () => {
    expect(normalizeToIsoUtc('2026-01-01T00:45:18-03:00')).toBe('2026-01-01T03:45:18.000Z');
  });

  it('rejects a timestamp it cannot parse', () => {
    expect(() => normalizeToIsoUtc('yesterday')).toThrow(/unparseable timestamp/);
  });
});

describe('toIncidentEvent', () => {
  it('maps the ITSM fields onto the universal schema', () => {
    const event = toIncidentEvent(itsmEvent);

    expect(event).toMatchObject({
      source: 'itsm',
      opened_at: '2025-12-31T23:45:18.000Z',
      severity: 2,
      entity_id: 'srv-web-04',
      status: 'closed',
    });
  });

  it('keeps the origin payload verbatim in payload_raw', () => {
    const event = toIncidentEvent(itsmEvent);

    expect(JSON.parse(event.payload_raw)).toEqual(itsmEvent.payload);
  });

  it('carries a column the origin added without the gateway knowing it', () => {
    const event = toIncidentEvent({ ...itsmEvent, payload: { origin_channel: 'chat' } });

    expect(JSON.parse(event.payload_raw)).toEqual({ origin_channel: 'chat' });
  });

  it('gives every event its own id', () => {
    expect(toIncidentEvent(itsmEvent).event_id).not.toBe(toIncidentEvent(itsmEvent).event_id);
  });
});

describe('webhookBodySchema', () => {
  it('accepts the contract of a registered source', () => {
    expect(webhookBodySchema.safeParse(itsmEvent).success).toBe(true);
  });

  it('reports the offending field when the payload breaks the contract', () => {
    const result = webhookBodySchema.safeParse({ ...itsmEvent, priority_code: 9 });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({ path: ['priority_code'] }),
    );
  });

  it('refuses a source no adapter claims', () => {
    const result = webhookBodySchema.safeParse({ ...itsmEvent, source: 'datadog' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['source']);
  });

  it('defaults the optional ITSM fields the dataset may leave blank', () => {
    const { configuration_item, status, ...withoutOptionals } = itsmEvent;

    expect(normalizeWebhook(webhookBodySchema.parse(withoutOptionals))).toMatchObject({
      entity_id: '',
      status: 'unknown',
    });
  });
});

describe('normalizeWebhook', () => {
  it('maps the body through the branch that owns its source', () => {
    expect(normalizeWebhook(itsmEvent)).toMatchObject({ source: 'itsm', severity: 2 });
  });
});
