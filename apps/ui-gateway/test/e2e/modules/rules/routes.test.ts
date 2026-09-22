import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authHeaders, createTestApp } from '../../../helpers/app.ts';
import { alertMapping } from '../../../helpers/mapping.ts';

const publish = vi.fn(async (_message: { topic: string; key: string; value: string }) => undefined);

describe('PUT /rules/mappings/:tenant/:source', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish, publishBatch: async () => undefined }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    publish.mockClear();
  });

  it('publishes bindings and dictionary as one record and answers 202', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/mappings/locaweb/itsm',
      payload: alertMapping,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ key: 'locaweb:itsm', topic: 'rules.mapping' });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('accepts a mapping with only the required bronze columns', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/mappings/locaweb/itsm',
      payload: {
        intake: 'alert',
        version: 'v1',
        bindings: {
          external_id: 'payload.ticket_number',
          opened_at: 'payload.opened_at',
          severity: 'payload.priority_code',
          status: 'fields.status',
          title: 'payload.short_description',
        },
        mappings: {},
      },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(202);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('rejects a mapping that omits a required bronze column with 400', async () => {
    const { status, ...rest } = alertMapping.bindings;
    expect(status).toBeDefined();
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/mappings/locaweb/itsm',
      payload: { ...alertMapping, bindings: rest },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it('answers 502 when the bus rejects the publish', async () => {
    publish.mockRejectedValueOnce(new Error('broker down'));

    const res = await app.inject({
      method: 'PUT',
      url: '/rules/mappings/locaweb/itsm',
      payload: alertMapping,
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(502);
  });
});

describe('PUT /rules/deadlines/:tenant', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish, publishBatch: async () => undefined }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    publish.mockClear();
  });

  it('publishes keyed by tenant', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/deadlines/locaweb',
      payload: { deadlines: [{ severity: 1, seconds: 14400 }] },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ key: 'locaweb', topic: 'rules.deadline' });
  });

  it('rejects an empty deadline list with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/deadlines/locaweb',
      payload: { deadlines: [] },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a repeated severity with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/deadlines/locaweb',
      payload: {
        deadlines: [
          { severity: 1, seconds: 14400 },
          { severity: 1, seconds: 7200 },
        ],
      },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('PUT /rules/targets/:tenant', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish, publishBatch: async () => undefined }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    publish.mockClear();
  });

  it('accepts severities instead of kpi_group', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/targets/locaweb',
      payload: {
        targets: [{ severities: [1, 2], max_breaches: 5, achievement_pct: 95 }],
      },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ key: 'locaweb', topic: 'rules.target' });
  });

  it('rejects a kpi_group payload with 400 — the field no longer exists', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/targets/locaweb',
      payload: {
        targets: [{ kpi_group: 'p1_p2', max_breaches: 5, achievement_pct: 95 }],
      },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET and history', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish, publishBatch: async () => undefined }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads the current deadlines after a PUT', async () => {
    const body = { deadlines: [{ severity: 1, seconds: 14400 }] };
    await app.inject({
      method: 'PUT',
      url: '/rules/deadlines/locaweb',
      payload: body,
      headers: authHeaders,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/rules/deadlines/locaweb',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(body);
  });

  it('lists the last published documents so a caller can PUT an older one again', async () => {
    await app.inject({
      method: 'PUT',
      url: '/rules/deadlines/locaweb',
      payload: { deadlines: [{ severity: 1, seconds: 7200 }] },
      headers: authHeaders,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/rules/deadlines/locaweb/history',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({
      deadlines: [{ severity: 1, seconds: 7200 }],
      id: expect.any(Number),
    });
  });
});

describe('GET /rules/schema', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => instance.decorate('kafka', { publish, publishBatch: async () => undefined }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/rules/schema' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the mapping, deadline and target JSON Schemas from the same Zod contracts', async () => {
    const res = await app.inject({ method: 'GET', url: '/rules/schema', headers: authHeaders });
    expect(res.statusCode).toBe(200);

    const body = res.json() as {
      mapping: { oneOf: { properties: { intake: { const: string }; bindings: { required: string[] } } }[] };
      deadlines: { properties: { deadlines: unknown } };
      targets: { properties: { targets: unknown } };
    };

    const alert = body.mapping.oneOf.find(variant => variant.properties.intake.const === 'alert');
    expect(alert?.properties.bindings.required).toEqual(
      expect.arrayContaining(['external_id', 'opened_at', 'severity', 'status', 'title']),
    );
    expect(body.deadlines.properties.deadlines).toBeDefined();
    expect(body.targets.properties.targets).toBeDefined();
  });
});
