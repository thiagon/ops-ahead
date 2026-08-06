import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from '../../../../src/plugins/kafka.ts';
import { createTestApp } from '../../../helpers/app.ts';

// The broker is out of scope here: what matters is that an accepted event
// reaches the publisher, and that a publisher failure becomes a 502.
const publish = vi.fn(async (_message: OutboundMessage) => undefined);

// One row of assets/incidents.csv, as scripts/incident_producer.py posts it.
const itsmEvent = {
  ticket_number: 'INC0012345',
  source: 'itsm',
  opened_at: '2025-12-31 23:45:18',
  priority_code: 2,
  configuration_item: 'srv-web-04',
  status: 'Resolvido',
  payload: { ticket_number: 'INC0012345', duration_seconds: '9120', kpi_breached: '1' },
};

describe('POST /webhook/incidents', () => {
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

  it('accepts an ITSM event and answers with its event id', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhook/incidents', payload: itsmEvent });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      source: 'itsm',
    });
  });

  it('publishes the normalized event keyed by its event id', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhook/incidents', payload: itsmEvent });

    expect(publish).toHaveBeenCalledTimes(1);
    const message = publish.mock.calls[0]?.[0];
    expect(message?.key).toBe(res.json().event_id);
    expect(JSON.parse(message?.value ?? '')).toMatchObject({
      event_id: res.json().event_id,
      source: 'itsm',
      opened_at: '2025-12-31T23:45:18.000Z',
      severity: 2,
      entity_id: 'srv-web-04',
      status: 'Resolvido',
    });
  });

  it('answers 502 when the event does not reach the bus', async () => {
    publish.mockRejectedValueOnce(new Error('broker down'));

    const res = await app.inject({ method: 'POST', url: '/webhook/incidents', payload: itsmEvent });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'PublishFailed' });
  });

  it('refuses a source no adapter claims', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/incidents',
      payload: { ...itsmEvent, source: 'datadog' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toContainEqual(expect.objectContaining({ path: 'source' }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('reports which field broke the origin contract', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/incidents',
      payload: { ...itsmEvent, priority_code: 9 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toContainEqual(expect.objectContaining({ path: 'priority_code' }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes the route in the openapi document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(res.json().paths['/webhook/incidents']).toBeDefined();
  });

  it('documents the body as one variant per source, under components', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();
    const body =
      doc.paths['/webhook/incidents'].post.requestBody.content['application/json'].schema;

    expect(body.$ref).toBe('#/components/schemas/IncidentWebhookInput');
    expect(doc.components.schemas.IncidentWebhookInput.oneOf).toEqual([
      { $ref: '#/components/schemas/ItsmWebhookInput' },
    ]);
    expect(doc.components.schemas.ItsmWebhookInput.properties.ticket_number).toBeDefined();
    expect(doc.components.schemas.IncidentEvent.properties.payload_raw).toBeDefined();
  });
});
