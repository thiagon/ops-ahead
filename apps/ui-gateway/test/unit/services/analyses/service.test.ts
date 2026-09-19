import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysesService } from '../../../../src/services/analyses/index.ts';
import { memoryPrisma } from '../../../helpers/app.ts';

const topics = { ml: 'trigger.ml', data: 'trigger.data' };

function updateKeyFrom(publish: ReturnType<typeof vi.fn>): string {
  const value = publish.mock.calls.at(-1)?.[0]?.value as string;
  return JSON.parse(value).update_key as string;
}

describe('AnalysesService.start', () => {
  let publish: ReturnType<typeof vi.fn>;
  let analyses: AnalysesService;

  beforeEach(() => {
    publish = vi.fn(async () => undefined);
    analyses = new AnalysesService(memoryPrisma(), { publish }, topics);
  });

  it('mints an id, stores pending, and publishes `analysis` intact keyed as run_id', async () => {
    const result = await analyses.start({ analysis: 'data_refresh' });
    const event = JSON.parse(publish.mock.calls[0]?.[0]?.value ?? '');

    expect(result).toEqual({ id: result.id });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await analyses.getStatus(result.id)).toEqual({ id: result.id, status: 'pending' });
    expect(event).toMatchObject({ run_id: result.id, analysis: 'data_refresh' });
    expect(event.update_key).toEqual(expect.any(String));
    expect(event.update_key).not.toBe(result.id);
  });

  it('mints a fresh id per call', async () => {
    const first = await analyses.start({ analysis: 'data_quality_check' });
    const second = await analyses.start({ analysis: 'data_quality_check' });

    expect(first.id).not.toBe(second.id);
  });

  it('carries volume_forecast split dates into the trigger.ml event', async () => {
    const request = {
      analysis: 'volume_forecast' as const,
      train_end: '2025-09-30',
      validation_end: '2025-10-31',
      holdout_end: '2026-01-31',
    };

    const result = await analyses.start(request);
    const event = JSON.parse(publish.mock.calls[0]?.[0]?.value ?? '');

    expect(event).toMatchObject({ run_id: result.id, ...request });
    expect(event.update_key).toEqual(expect.any(String));
  });

  it.each([
    ['volume_forecast', 'trigger.ml'],
    ['breach_risk', 'trigger.ml'],
    ['kpi_projection', 'trigger.ml'],
    ['external_event_detection', 'trigger.ml'],
    ['data_refresh', 'trigger.data'],
    ['data_quality_check', 'trigger.data'],
  ] as const)('routes %s to %s', async (analysis, topic) => {
    const request =
      analysis === 'volume_forecast' || analysis === 'breach_risk'
        ? {
            analysis,
            train_end: '2025-09-30',
            validation_end: '2025-10-31',
            holdout_end: '2026-01-31',
          }
        : { analysis };

    await analyses.start(request);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ topic }));
  });
});

describe('AnalysesService status', () => {
  it('rejects an unknown id — pending is only a stored row, never a guess', async () => {
    const analyses = new AnalysesService(
      memoryPrisma(),
      { publish: async () => undefined },
      topics,
    );

    await expect(analyses.getStatus('unknown')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reflects whatever update last stored for that id when the kafka key is presented', async () => {
    const publish = vi.fn(async () => undefined);
    const analyses = new AnalysesService(memoryPrisma(), { publish }, topics);
    const started = await analyses.start({ analysis: 'data_refresh' });
    const status = {
      status: 'running' as const,
      started_at: new Date('2026-08-15T12:30:00Z'),
    };

    await analyses.update(started.id, status, updateKeyFrom(publish));

    expect(await analyses.getStatus(started.id)).toEqual({ id: started.id, ...status });
  });

  it('rejects an update with the wrong key', async () => {
    const analyses = new AnalysesService(
      memoryPrisma(),
      { publish: async () => undefined },
      topics,
    );
    const started = await analyses.start({ analysis: 'data_refresh' });

    await expect(
      analyses.update(started.id, { status: 'running' }, 'not-the-key'),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
