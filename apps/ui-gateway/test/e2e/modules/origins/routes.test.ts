import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../helpers/app.ts';

describe('origin routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the registered origins without their secrets', async () => {
    const res = await app.inject({ method: 'GET', url: '/origins' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toContainEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
    });
    for (const origin of res.json()) expect(origin).not.toHaveProperty('secret');
  });

  it('registers an origin and answers with the minted secret', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/origins/locaweb/datadog',
      payload: { intake: 'monitor' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      origin: { tenant_id: 'locaweb', source: 'datadog', intake: 'monitor' },
      secret: expect.any(String),
    });
  });

  it('accepts a webhook signed with the secret it just handed out', async () => {
    const registered = await app.inject({
      method: 'PUT',
      url: '/origins/locaweb/opsgenie',
      payload: { intake: 'alert' },
    });
    const { secret } = registered.json();
    const body = JSON.stringify({ ticket_number: 'INC1' });

    const res = await app.inject({
      method: 'POST',
      url: '/webhook/locaweb/opsgenie',
      headers: {
        'content-type': 'application/json',
        'x-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
      body,
    });

    expect(res.statusCode).toBe(202);
  });

  it('rejects an intake the contracts do not declare', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/origins/locaweb/datadog',
      payload: { intake: 'webhook' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rotates a secret and answers with the new one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/origins/locaweb/itsm/secret',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().secret).toEqual(expect.any(String));
    expect(res.json().origin).toEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
    });
  });

  it('takes a secret the caller chose on rotation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/origins/locaweb/zabbix/secret',
      payload: { secret: 'a-secret-long-enough' },
    });

    expect(res.json().secret).toBe('a-secret-long-enough');
  });

  it('answers 404 rotating an origin nobody registered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/origins/locaweb/nowhere/secret',
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('never documents a secret on the way in as required', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(doc.components.schemas.Origin.properties).not.toHaveProperty('secret');
  });
});
