import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunStatus } from '../../../../src/modules/runs/schema.ts';
import { createTestApp } from '../../../helpers/app.ts';

describe('GET /runs/:run_id', () => {
  let app: FastifyInstance;
  const store = new Map<string, RunStatus>();

  beforeAll(async () => {
    app = await createTestApp(instance =>
      instance.decorate('runStatus', { get: (id: string) => store.get(id) }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports queued for a run no status message has arrived for yet', async () => {
    const res = await app.inject({ method: 'GET', url: '/runs/never-seen' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ run_id: 'never-seen', status: 'queued' });
  });

  it('reflects Running once the job has picked up the message', async () => {
    store.set('run-1', { run_id: 'run-1', status: 'Running', started_at: '2026-08-15T12:30:00Z' });

    const res = await app.inject({ method: 'GET', url: '/runs/run-1' });

    expect(res.json()).toEqual({
      run_id: 'run-1',
      status: 'Running',
      started_at: '2026-08-15T12:30:00Z',
    });
  });

  it('reflects a terminal status with its detail, never touching Kubernetes', async () => {
    store.set('run-2', {
      run_id: 'run-2',
      status: 'Succeeded',
      started_at: '2026-08-15T12:30:00Z',
      finished_at: '2026-08-15T12:34:12Z',
      detail: { mlflow_run_id: '8f2a1c', model_version: '1' },
    });

    const res = await app.inject({ method: 'GET', url: '/runs/run-2' });

    expect(res.json()).toMatchObject({
      status: 'Succeeded',
      detail: { mlflow_run_id: '8f2a1c', model_version: '1' },
    });
  });
});
