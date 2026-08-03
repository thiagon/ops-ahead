import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../helpers/app.ts';

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
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts an ITSM event and answers with its event id', async () => {
    const res = await app.inject({ method: 'POST', url: '/webhook/incidents', payload: itsmEvent });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      source: 'itsm',
    });
  });

  it('refuses a source no adapter claims', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/incidents',
      payload: { ...itsmEvent, source: 'datadog' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'UnknownSource' });
  });

  it('reports which field broke the origin contract', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/incidents',
      payload: { ...itsmEvent, priority_code: 9 },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().details).toContainEqual(expect.objectContaining({ path: 'priority_code' }));
  });

  it('publishes the route in the openapi document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(res.json().paths['/webhook/incidents']).toBeDefined();
  });
});
