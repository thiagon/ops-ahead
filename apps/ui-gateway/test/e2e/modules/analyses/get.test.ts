import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { authHeaders, createTestApp } from '../../../helpers/app.ts';

const publish = vi.fn(async (_message: { topic: string; key: string; value: string }) => undefined);

function lastRunKey(): string {
  const value = publish.mock.calls.at(-1)?.[0]?.value ?? '{}';
  return JSON.parse(value).run_key as string;
}

describe('GET /analyses/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance =>
      instance.decorate('kafka', { publish, publishBatch: async () => undefined }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 404 for an id that was never started', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analyses/never-seen',
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NotFoundError', message: 'analysis not found' });
  });

  it('reflects running after PATCH with the kafka run key', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'data_refresh' },
      headers: authHeaders,
    });
    const { id } = started.json();

    await app.inject({
      method: 'PATCH',
      url: `/analyses/${id}`,
      headers: { 'x-run-key': lastRunKey() },
      payload: { status: 'running', started_at: '2026-08-15T12:30:00Z' },
    });

    const res = await app.inject({ method: 'GET', url: `/analyses/${id}`, headers: authHeaders });

    expect(res.json()).toEqual({
      id,
      analysis: 'data_refresh',
      trigger: 'manual',
      status: 'running',
      started_at: '2026-08-15T12:30:00.000Z',
    });
  });

  it('reflects a terminal status with its detail, never touching Kubernetes', async () => {
    const started = await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'data_refresh' },
      headers: authHeaders,
    });
    const { id } = started.json();

    await app.inject({
      method: 'PATCH',
      url: `/analyses/${id}`,
      headers: { 'x-run-key': lastRunKey() },
      payload: {
        status: 'succeeded',
        started_at: '2026-08-15T12:30:00.000Z',
        finished_at: '2026-08-15T12:34:12Z',
        detail: { mlflow_run_id: '8f2a1c', model_version: '1' },
      },
    });

    const res = await app.inject({ method: 'GET', url: `/analyses/${id}`, headers: authHeaders });

    expect(res.json()).toMatchObject({
      status: 'succeeded',
      detail: { mlflow_run_id: '8f2a1c', model_version: '1' },
    });
  });
});

describe('PATCH /analyses/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance =>
      instance.decorate('kafka', { publish, publishBatch: async () => undefined }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function startRun() {
    const started = await app.inject({
      method: 'POST',
      url: '/locaweb/analyses',
      payload: { analysis: 'data_refresh' },
      headers: authHeaders,
    });
    return { id: started.json().id as string, runKey: lastRunKey() };
  }

  it('returns the updated status when the kafka key is presented', async () => {
    const { id, runKey } = await startRun();

    const res = await app.inject({
      method: 'PATCH',
      url: `/analyses/${id}`,
      headers: { 'x-run-key': runKey },
      payload: { status: 'running', started_at: '2026-08-15T12:30:00Z' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id,
      analysis: 'data_refresh',
      trigger: 'manual',
      status: 'running',
      started_at: '2026-08-15T12:30:00.000Z',
    });
  });

  it('rejects an unknown status with 400', async () => {
    const { id, runKey } = await startRun();

    const res = await app.inject({
      method: 'PATCH',
      url: `/analyses/${id}`,
      headers: { 'x-run-key': runKey },
      payload: { status: 'Running' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing key with 400 — the 202 never carried it', async () => {
    const { id } = await startRun();

    const res = await app.inject({
      method: 'PATCH',
      url: `/analyses/${id}`,
      payload: { status: 'running' },
      headers: authHeaders,
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects the wrong key with 401', async () => {
    const { id } = await startRun();

    const res = await app.inject({
      method: 'PATCH',
      url: `/analyses/${id}`,
      headers: { 'x-run-key': 'not-the-key' },
      payload: { status: 'running' },
    });

    expect(res.statusCode).toBe(401);
  });
});
