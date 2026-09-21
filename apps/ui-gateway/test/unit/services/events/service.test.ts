import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from '../../../../src/lib/kafka.ts';
import {
  buildEnvelope,
  type EventOrigin,
  EventsService,
} from '../../../../src/services/events/index.ts';

const topics = { alert: 'events.raw.alert', monitor: 'events.raw.monitor' };

const ITSM_ORIGIN: EventOrigin = {
  tenantId: 'locaweb',
  source: 'itsm',
  intake: 'alert',
  version: 'v1',
};

// One row of assets/incidents.csv, as scripts/incident_producer.py posts it.
const itsmBody = {
  ticket_number: 'INC0012345',
  opened_at: '2025-12-31 23:45:18',
  priority_code: 2,
  configuration_item: 'srv-web-04',
  status: 'Encerrado',
  opened_by: 'Monitoramento',
};

describe('buildEnvelope', () => {
  it('assigns identity, tenant, source, and intake from the origin — nothing from the body', () => {
    const envelope = buildEnvelope(ITSM_ORIGIN, itsmBody);

    expect(envelope).toMatchObject({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      version: 'v1',
    });
  });

  it('keeps the origin body verbatim, opaque, in payload', () => {
    const envelope = buildEnvelope(ITSM_ORIGIN, itsmBody);

    expect(JSON.parse(envelope.payload)).toEqual(itsmBody);
  });

  it('is not influenced by a body that tries to declare its own source or tenant', () => {
    const envelope = buildEnvelope(ITSM_ORIGIN, {
      ...itsmBody,
      source: 'datadog',
      tenant_id: 'someone-else',
      intake: 'monitor',
    });

    expect(envelope).toMatchObject({ tenant_id: 'locaweb', source: 'itsm', intake: 'alert' });
  });

  it('gives every event its own id', () => {
    expect(buildEnvelope(ITSM_ORIGIN, itsmBody).event_id).not.toBe(
      buildEnvelope(ITSM_ORIGIN, itsmBody).event_id,
    );
  });
});

describe('EventsService.ingest', () => {
  let publish: ReturnType<typeof vi.fn<(message: OutboundMessage) => Promise<void>>>;
  let events: EventsService;

  beforeEach(() => {
    publish = vi.fn(async (_message: OutboundMessage) => undefined);
    events = new EventsService({ publish, publishBatch: async () => undefined }, topics);
  });

  it('publishes the raw envelope keyed by its event id and answers with that identity', async () => {
    const result = await events.ingest(ITSM_ORIGIN, itsmBody);
    const message = publish.mock.calls[0]?.[0];
    const envelope = JSON.parse(message?.value ?? '');

    expect(result).toEqual({
      event_id: result.event_id,
      tenant_id: 'locaweb',
      source: 'itsm',
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(message?.topic).toBe('events.raw.alert');
    expect(message?.key).toBe(result.event_id);
    expect(envelope).toMatchObject({
      event_id: result.event_id,
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      version: 'v1',
    });
    expect(JSON.parse(envelope.payload)).toEqual(itsmBody);
  });

  it.each([
    ['alert', 'events.raw.alert'],
    ['monitor', 'events.raw.monitor'],
  ] as const)('routes %s intake to %s', async (intake, topic) => {
    await events.ingest({ ...ITSM_ORIGIN, intake }, itsmBody);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ topic }));
  });
});
