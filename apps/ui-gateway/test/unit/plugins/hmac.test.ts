import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkSignature } from '../../../src/plugins/hmac.ts';
import { createTestApp } from '../../helpers/app.ts';

const SECRET = 'itsm-shared-secret';
const ROUTE = '/webhook/alert/locaweb/itsm';

const itsmEvent = { ticket_number: 'INC0012345', priority_code: 2, status: 'Encerrado' };

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('checkSignature', () => {
  it('accepts a digest of the exact body bytes', () => {
    expect(checkSignature(sign('{"a":1}'), '{"a":1}', SECRET)).toBe('valid');
  });

  it('rejects a digest computed over a different body', () => {
    expect(checkSignature(sign('{"a":1}'), '{"a":2}', SECRET)).toBe('invalid');
  });

  it('rejects a digest computed with another secret', () => {
    expect(checkSignature(sign('{"a":1}', 'other'), '{"a":1}', SECRET)).toBe('invalid');
  });

  it('reports a missing header apart from a wrong one', () => {
    expect(checkSignature(undefined, '{"a":1}', SECRET)).toBe('missing');
  });

  it('rejects a header without the sha256 prefix', () => {
    expect(
      checkSignature(createHmac('sha256', SECRET).update('{}').digest('hex'), '{}', SECRET),
    ).toBe('invalid');
  });

  it('rejects a header that is not hex', () => {
    expect(checkSignature('sha256=not-a-digest', '{}', SECRET)).toBe('invalid');
  });
});

describe('signature verification enabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.HMAC_ENABLED = 'true';
    process.env.HMAC_SECRET = SECRET;
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.HMAC_ENABLED;
    delete process.env.HMAC_SECRET;
  });

  it('accepts a signed request', async () => {
    const body = JSON.stringify(itsmEvent);
    const res = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'application/json', 'x-signature': sign(body) },
      body,
    });

    expect(res.statusCode).toBe(202);
  });

  it('refuses an unsigned request', async () => {
    const res = await app.inject({ method: 'POST', url: ROUTE, payload: itsmEvent });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'UnauthorizedError' });
  });

  it('refuses a request whose body was tampered with after signing', async () => {
    const signature = sign(JSON.stringify(itsmEvent));
    const body = JSON.stringify({ ...itsmEvent, priority_code: 1 });
    const res = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'application/json', 'x-signature': signature },
      body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('answers an unsigned malformed body with 401, not a parser error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: ROUTE,
      headers: { 'content-type': 'application/json' },
      body: '{"ticket_number": "INC1",',
    });

    expect(res.statusCode).toBe(401);
  });

  it('leaves the routes that did not opt in alone', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
  });
});

describe('signature verification disabled', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts an unsigned request so dev runs the loop without a secret', async () => {
    const res = await app.inject({ method: 'POST', url: ROUTE, payload: itsmEvent });

    expect(res.statusCode).toBe(202);
  });
});
