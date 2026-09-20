import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../../helpers/app.ts';

const publish = vi.fn(async (_message: { topic: string; key: string; value: string }) => undefined);

const mapping = {
  intake: 'alert',
  dictionary_version: 'v1',
  bindings: [{ field: 'status', path: 'fields.status' }],
  mappings: { status: { Aberto: 'open' } },
};

describe('PUT /rules/mappings/:tenant/:source', () => {
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

  it('publishes bindings and dictionary as one record and answers 202', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/mappings/locaweb/service_now',
      payload: mapping,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ key: 'locaweb:service_now', topic: 'rules.mapping' });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('rejects a mapping with no bindings with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/mappings/locaweb/service_now',
      payload: { ...mapping, bindings: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it('answers 502 when the bus rejects the publish', async () => {
    publish.mockRejectedValueOnce(new Error('broker down'));

    const res = await app.inject({
      method: 'PUT',
      url: '/rules/mappings/locaweb/service_now',
      payload: mapping,
    });

    expect(res.statusCode).toBe(502);
  });
});

describe('PUT /rules/deadlines/:tenant', () => {
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

  it('publishes keyed by tenant', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/deadlines/locaweb',
      payload: { deadlines: [{ severity: 1, deadline_seconds: 14400 }] },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ key: 'locaweb', topic: 'rules.deadline' });
  });

  it('rejects an empty deadline list with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/deadlines/locaweb',
      payload: { deadlines: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('PUT /rules/targets/:tenant', () => {
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

  it('accepts severities instead of kpi_group', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/rules/targets/locaweb',
      payload: {
        targets: [{ severities: [1, 2], max_breaches: 5, achievement_pct: 95 }],
      },
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
    });

    expect(res.statusCode).toBe(400);
  });
});
