import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../helpers/app.ts';

describe('source routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists a tenant's sources without their secrets", async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants/locaweb/sources' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toContainEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
    });
    for (const source of res.json()) expect(source).not.toHaveProperty('secret');
  });

  it("never lists another tenant's sources", async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants/outro-tenant/sources' });

    expect(res.json()).toEqual([]);
  });

  it('registers a source and answers with the minted secret', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/tenants/locaweb/sources/datadog',
      payload: { intake: 'monitor' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      source: { tenant_id: 'locaweb', source: 'datadog', intake: 'monitor' },
      secret: expect.any(String),
    });
  });

  it('accepts a webhook signed with the secret it just handed out', async () => {
    const registered = await app.inject({
      method: 'PUT',
      url: '/tenants/locaweb/sources/opsgenie',
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
      url: '/tenants/locaweb/sources/datadog',
      payload: { intake: 'webhook' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rotates a secret and answers with the new one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/locaweb/sources/itsm/secret',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().secret).toEqual(expect.any(String));
    expect(res.json().source).toEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
    });
  });

  it('takes a secret the caller chose on rotation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/locaweb/sources/zabbix/secret',
      payload: { secret: 'a-secret-long-enough' },
    });

    expect(res.json().secret).toBe('a-secret-long-enough');
  });

  it('answers 404 rotating a source nobody registered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/tenants/locaweb/sources/nowhere/secret',
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('never documents a secret on the listed source', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(doc.components.schemas.Source.properties).not.toHaveProperty('secret');
  });
});
