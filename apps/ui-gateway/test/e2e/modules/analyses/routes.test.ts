import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../../helpers/app.ts';

const publish = vi.fn(
  async (_message: { topic: string; key: string; value: string }) => undefined,
);

describe('POST /analyses', () => {
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

  it('accepts a volume_forecast request and answers with an id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: {
        analysis: 'volume_forecast',
        train_end: '2025-09-30',
        validation_end: '2025-10-31',
        holdout_end: '2026-01-31',
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(res.json()).not.toHaveProperty('update_key');
  });

  it('publishes the event, analysis intact, keyed by run_id, to trigger.ml', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: {
        analysis: 'breach_risk',
        train_end: '2025-02-15',
        validation_end: '2025-03-15',
        holdout_end: '2025-04-09',
      },
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [message] = publish.mock.calls[0] ?? [];
    expect(message?.topic).toBe('trigger.ml');
    expect(message?.key).toBe(res.json().id);
    expect(JSON.parse(message?.value ?? '')).toMatchObject({
      run_id: res.json().id,
      analysis: 'breach_risk',
      train_end: '2025-02-15',
      update_key: expect.any(String),
    });
  });

  it('accepts a bare kpi_projection request and routes it to trigger.ml', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'kpi_projection' },
    });

    expect(res.statusCode).toBe(202);
    expect(publish.mock.calls[0]?.[0]?.topic).toBe('trigger.ml');
  });

  it('routes data_refresh/data_quality_check to trigger.data', async () => {
    await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'data_refresh' },
    });

    expect(publish.mock.calls[0]?.[0]?.topic).toBe('trigger.data');
  });

  it('rejects volume_forecast missing split dates with 400, never 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'volume_forecast' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().details).toContainEqual(expect.objectContaining({ path: 'train_end' }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects an unknown analysis with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'not_a_real_analysis' },
    });

    expect(res.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a data_source override — removed for SSRF/credential-leak risk', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'data_refresh', data_source: 'clickhouse://attacker.example/x' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('answers 502 when the event does not reach the bus', async () => {
    publish.mockRejectedValueOnce(new Error('broker down'));

    const res = await app.inject({
      method: 'POST',
      url: '/analyses',
      payload: { analysis: 'data_quality_check' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'PublishFailed' });
  });
});
