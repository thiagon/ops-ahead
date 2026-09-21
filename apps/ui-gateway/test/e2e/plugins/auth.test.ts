import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  authHeaders,
  createTestApp,
  sessionHeaders,
  TEST_BEARER,
  TEST_TENANTS,
} from '../../helpers/app.ts';

const publish = vi.fn(async (_message: { topic: string; key: string; value: string }) => undefined);

function runKeyOf(): string {
  return JSON.parse(publish.mock.calls.at(-1)?.[0]?.value ?? '{}').run_key as string;
}

describe('the boundary is closed by default', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['GET', '/sources/locaweb'],
    ['GET', '/rules/deadlines/locaweb'],
    ['GET', '/locaweb/analyses'],
  ])('answers 401 to an unauthenticated %s %s', async (method, url) => {
    const res = await app.inject({ method: method as 'GET', url });

    expect(res.statusCode).toBe(401);
  });

  it('answers 401 to a POST that brings no credential at all', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'full_pipeline' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('answers 401 to a token the provider does not recognize', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sources/locaweb',
      headers: { authorization: 'Bearer some-other-token' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('leaves health open — a probe has no credential to bring', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('tenant in the URL is selection, the claim is authorization', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 403 for a tenant the caller does not act for', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sources/alheio',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(403);
  });

  it('serves a tenant that is in the claim', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/sources/locaweb',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
  });

  it('reports the caller and the tenants their groups carry', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: authHeaders });

    expect(res.json()).toEqual({ sub: 'test-user', tenants: ['locaweb', 'outro-tenant'] });
  });
});

describe('provenance comes from the credential, never the body', () => {
  let app: FastifyInstance;
  let schedulerKey: string;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
    schedulerKey = (await app.services.apiKeys.issue()).key;
  });

  afterAll(async () => {
    await app.close();
  });

  it('labels a person’s run manual', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'kpi_projection', tenant_id: 'locaweb' },
      headers: authHeaders,
    });

    const status = await app.inject({
      method: 'GET',
      url: `/analyses/${started.json().id}`,
      headers: authHeaders,
    });
    expect(status.json()).toMatchObject({ trigger: 'manual' });
  });

  it('labels the scheduler key’s run scheduled', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'full_pipeline' },
      headers: { authorization: `Bearer ${schedulerKey}` },
    });

    expect(started.statusCode).toBe(202);
    const status = await app.inject({
      method: 'GET',
      url: `/analyses/${started.json().id}`,
      headers: authHeaders,
    });
    expect(status.json()).toMatchObject({ trigger: 'scheduled' });
  });

  it('refuses the scheduler key on anything but the daily chain', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'data_refresh' },
      headers: { authorization: `Bearer ${schedulerKey}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('chains a run off the full_pipeline whose run key it presents', async () => {
    const parent = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'full_pipeline' },
      headers: { authorization: `Bearer ${schedulerKey}` },
    });
    const parentRunKey = runKeyOf();

    const child = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'kpi_projection', tenant_id: 'locaweb' },
      headers: { 'x-run-key': parentRunKey },
    });

    expect(child.statusCode).toBe(202);
    const status = await app.inject({
      method: 'GET',
      url: `/analyses/${child.json().id}`,
      headers: authHeaders,
    });
    expect(status.json()).toMatchObject({
      trigger: 'chained',
      parent_id: parent.json().id,
    });
  });

  it('refuses to chain off a training — only the daily chain starts others', async () => {
    await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'kpi_projection', tenant_id: 'locaweb' },
      headers: authHeaders,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'data_refresh' },
      headers: { 'x-run-key': runKeyOf() },
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects a body that tries to declare its own provenance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'data_refresh', trigger: 'scheduled' },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('MCP authenticates by Bearer, never by cookie', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('points an unauthenticated client at the authorization server', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp/locaweb',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata=');
  });

  it('answers 403 for a tenant outside the token’s groups', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mcp/alheio',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      headers: { ...authHeaders, accept: 'application/json, text/event-stream' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('publishes the document an MCP client reads after the 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/oauth-protected-resource',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ authorization_servers: expect.any(Array) });
  });
});

describe('the run key still owns the PATCH', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts the run key of that very run and no session', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'data_refresh' },
      headers: authHeaders,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/analyses/${started.json().id}`,
      headers: { 'x-run-key': runKeyOf() },
      payload: { status: 'running', started_at: '2026-09-20T12:00:00Z' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects another run’s key', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'data_refresh' },
      headers: authHeaders,
    });
    await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'data_quality_check' },
      headers: authHeaders,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/analyses/${first.json().id}`,
      headers: { 'x-run-key': runKeyOf() },
      payload: { status: 'running', started_at: '2026-09-20T12:00:00Z' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('the browser spends a cookie, not a Bearer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts the session cookie on a GET', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: sessionHeaders(app),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sub: 'test-user', tenants: TEST_TENANTS });
  });

  it('rejects a state-changing request whose CSRF header does not match', async () => {
    const { cookie } = sessionHeaders(app);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(403);
  });

  it('logout with the matching CSRF header clears the cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: sessionHeaders(app),
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('oa_session='),
        expect.stringContaining('Max-Age=0'),
      ]),
    );
  });

  it('refreshes an expired access token in place while the refresh token lives', async () => {
    app.services.oidc.refresh = async () => ({
      accessToken: TEST_BEARER,
      refreshToken: 'next-refresh',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: sessionHeaders(app, 'expired-access-token'),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sub: 'test-user', tenants: TEST_TENANTS });
    expect([res.headers['set-cookie']].flat().join(';')).toContain('oa_session=');
  });

  it('keeps /docs behind a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/docs' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/docs/', headers: authHeaders })).statusCode,
    ).toBe(200);
  });
});
