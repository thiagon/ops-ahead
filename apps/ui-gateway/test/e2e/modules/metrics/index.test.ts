import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from '../../../../src/plugins/kafka.ts';
import { createTestApp } from '../../../helpers/app.ts';

const SECRET = 'itsm-shared-secret';

const publish = vi.fn(async (_message: OutboundMessage) => undefined);

const itsmEvent = {
  ticket_number: 'INC0012345',
  source: 'itsm',
  opened_at: '2025-12-31 23:45:18',
  priority_code: 2,
  configuration_item: 'srv-web-04',
  status: 'Encerrado',
  opened_by: 'Monitoramento',
  payload: { ticket_number: 'INC0012345' },
};

describe('GET /metrics', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HMAC_ENABLED = 'true';
    process.env.HMAC_SECRET = SECRET;
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
  });

  afterAll(async () => {
    await app.close();
    delete process.env.HMAC_ENABLED;
    delete process.env.HMAC_SECRET;
  });

  function post(body: object, signed = true) {
    const payload = JSON.stringify(body);
    const signature = createHmac('sha256', SECRET).update(payload).digest('hex');
    return app.inject({
      method: 'POST',
      url: '/webhook/incidents',
      headers: {
        'content-type': 'application/json',
        ...(signed ? { 'x-signature': `sha256=${signature}` } : {}),
      },
      body: payload,
    });
  }

  it('exposes the runtime metrics prom-client collects', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('process_cpu_seconds_total');
  });

  it('counts published events, publish failures and rejected signatures', async () => {
    await post(itsmEvent);
    publish.mockRejectedValueOnce(new Error('broker down'));
    await post(itsmEvent);
    await post(itsmEvent, false);

    const res = await app.inject({ method: 'GET', url: '/metrics' });

    expect(res.body).toMatch(/gateway_events_published_total\{source="itsm"\} 1\b/);
    expect(res.body).toMatch(/gateway_publish_failures_total\{source="itsm"\} 1\b/);
    expect(res.body).toMatch(/gateway_signature_failures_total\{reason="missing"\} 1\b/);
  });

  it('stays out of the openapi document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(res.json().paths['/metrics']).toBeUndefined();
  });
});
