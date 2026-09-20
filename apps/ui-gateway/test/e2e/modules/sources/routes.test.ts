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
    const res = await app.inject({ method: 'GET', url: '/sources/locaweb' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toContainEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      status: 'active',
    });
    for (const source of res.json()) expect(source).not.toHaveProperty('secret');
  });

  it("never lists another tenant's sources", async () => {
    const res = await app.inject({ method: 'GET', url: '/sources/outro-tenant' });

    expect(res.json()).toEqual([]);
  });

  it('registers a source and answers with the minted secret', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/datadog',
      payload: { intake: 'monitor' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      source: { tenant_id: 'locaweb', source: 'datadog', intake: 'monitor', status: 'active' },
      secret: expect.any(String),
    });
  });

  it('accepts a webhook signed with the secret it just handed out', async () => {
    const registered = await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/opsgenie',
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
      url: '/sources/locaweb/datadog',
      payload: { intake: 'webhook' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rotates a secret and answers with the new one', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sources/locaweb/itsm/secret',
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().secret).toEqual(expect.any(String));
    expect(res.json().source).toEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      status: 'active',
    });
  });

  it('takes a secret the caller chose on rotation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sources/locaweb/zabbix/secret',
      payload: { secret: 'a-secret-long-enough' },
    });

    expect(res.json().secret).toBe('a-secret-long-enough');
  });

  it('answers 404 rotating a source nobody registered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/sources/locaweb/nowhere/secret',
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('disables a source and answers its webhooks with 403', async () => {
    const registered = await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/pagerduty',
      payload: { intake: 'alert' },
    });
    const { secret } = registered.json();

    const disabled = await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/pagerduty/status',
      payload: { status: 'disabled' },
    });
    expect(disabled.json().status).toBe('disabled');

    const body = JSON.stringify({ ticket_number: 'INC1' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/locaweb/pagerduty',
      headers: {
        'content-type': 'application/json',
        'x-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
      body,
    });

    // 403, not 404: the address exists, it is turned off.
    expect(res.statusCode).toBe(403);
  });

  it('enables a source back and its webhooks answer again', async () => {
    const registered = await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/statuspage',
      payload: { intake: 'alert' },
    });
    const { secret } = registered.json();
    await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/statuspage/status',
      payload: { status: 'disabled' },
    });

    await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/statuspage/status',
      payload: { status: 'active' },
    });

    const body = JSON.stringify({ ticket_number: 'INC1' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhook/locaweb/statuspage',
      headers: {
        'content-type': 'application/json',
        'x-signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
      },
      body,
    });

    expect(res.statusCode).toBe(202);
  });

  it('rejects a status the schema does not declare', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/itsm/status',
      payload: { status: 'paused' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('answers 404 changing the status of a source nobody registered', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/sources/locaweb/nowhere/status',
      payload: { status: 'disabled' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('never documents a secret on the listed source', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(doc.components.schemas.Source.properties).not.toHaveProperty('secret');
  });
});
