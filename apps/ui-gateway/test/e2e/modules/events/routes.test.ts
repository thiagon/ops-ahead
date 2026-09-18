import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from '../../../../src/plugins/kafka.ts';
import { createTestApp } from '../../../helpers/app.ts';

const ROUTE = '/webhook/v1/locaweb/itsm';

// The broker is out of scope here: what matters is that an accepted event
// reaches the publisher, on the right topic, and that a publisher failure
// becomes a 502.
const publish = vi.fn(async (_message: OutboundMessage) => undefined);

// One row of assets/incidents.csv, as scripts/incident_producer.py posts it —
// opaque from the gateway's point of view.
const itsmEvent = {
  ticket_number: 'INC0012345',
  opened_at: '2025-12-31 23:45:18',
  priority_code: 2,
  configuration_item: 'srv-web-04',
  status: 'Encerrado',
  opened_by: 'Monitoramento',
};

describe('POST /webhook/v1/locaweb/itsm', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    publish.mockClear();
  });

  it('accepts an ITSM event and answers with its event, tenant, and source ids', async () => {
    const res = await app.inject({ method: 'POST', url: ROUTE, payload: itsmEvent });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      tenant_id: 'locaweb',
      source: 'itsm',
    });
  });

  it('publishes the raw envelope, keyed by its event id, to the alert raw topic', async () => {
    const res = await app.inject({ method: 'POST', url: ROUTE, payload: itsmEvent });

    expect(publish).toHaveBeenCalledTimes(1);
    const message = publish.mock.calls[0]?.[0];
    expect(message?.topic).toBe('events.raw.alert');
    expect(message?.key).toBe(res.json().event_id);
    const envelope = JSON.parse(message?.value ?? '');
    expect(envelope).toMatchObject({
      event_id: res.json().event_id,
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
    });
    expect(JSON.parse(envelope.payload)).toEqual(itsmEvent);
  });

  it('answers 502 when the event does not reach the bus', async () => {
    publish.mockRejectedValueOnce(new Error('broker down'));

    const res = await app.inject({ method: 'POST', url: ROUTE, payload: itsmEvent });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'PublishFailed' });
  });

  it('answers 404 for a credential the gateway does not have', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/v1/locaweb/datadog',
      payload: itsmEvent,
    });

    expect(res.statusCode).toBe(404);
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a non-object body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify('not an object'),
    });

    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes one parameterized ingest route, not one per origin', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(res.json().paths['/webhook/{version}/{tenant}/{source}']).toBeDefined();
  });

  it('documents the envelope published to the bus', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(doc.components.schemas.EventEnvelope.properties.payload).toBeDefined();
    expect(doc.components.schemas.EventEnvelope.properties.tenant_id).toBeDefined();
  });
});
