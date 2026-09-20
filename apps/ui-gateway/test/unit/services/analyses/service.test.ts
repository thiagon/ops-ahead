import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from '../../../../src/plugins/kafka.ts';
import { AnalysesService } from '../../../../src/services/analyses/index.ts';
import { memoryPrisma } from '../../../helpers/app.ts';

const topics = { ml: 'trigger.ml', data: 'trigger.data' };

function updateKeyFrom(publish: { mock: { calls: unknown[][] } }): string {
  const message = publish.mock.calls.at(-1)?.[0] as OutboundMessage | undefined;
  return JSON.parse(message?.value ?? '{}').update_key as string;
}

describe('AnalysesService.start', () => {
  let publish: ReturnType<typeof vi.fn<(message: OutboundMessage) => Promise<void>>>;
  let analyses: AnalysesService;

  beforeEach(() => {
    publish = vi.fn(async (_message: OutboundMessage) => undefined);
    analyses = new AnalysesService(memoryPrisma(), { publish }, topics);
  });

  it('mints an id, stores pending, and publishes `analysis` intact keyed as run_id', async () => {
    const result = await analyses.start({ analysis: 'data_refresh' });
    const event = JSON.parse(publish.mock.calls[0]?.[0]?.value ?? '');

    expect(result).toEqual({ id: result.id });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await analyses.getStatus(result.id)).toEqual({
      id: result.id,
      analysis: 'data_refresh',
      trigger: 'manual',
      status: 'pending',
    });
    expect(event).toMatchObject({ run_id: result.id, analysis: 'data_refresh' });
    expect(event.update_key).toEqual(expect.any(String));
    expect(event.update_key).not.toBe(result.id);
  });

  it('defaults a run nobody labelled to manual', async () => {
    const result = await analyses.start({ analysis: 'data_refresh', trigger: 'manual' });

    expect(await analyses.getStatus(result.id)).toMatchObject({
      analysis: 'data_refresh',
      trigger: 'manual',
    });
  });

  it('records a chained run against the full_pipeline it came from', async () => {
    const parent = await analyses.start({ analysis: 'full_pipeline', trigger: 'scheduled' });
    const child = await analyses.start({
      analysis: 'kpi_projection',
      tenant_id: 'locaweb',
      trigger: 'chained',
      parent_id: parent.id,
    });

    expect(await analyses.getStatus(child.id)).toMatchObject({
      trigger: 'chained',
      parent_id: parent.id,
    });
  });

  it('keeps provenance out of the Kafka event — the contracts forbid extra keys', async () => {
    await analyses.start({ analysis: 'data_refresh', trigger: 'scheduled' });
    const event = JSON.parse(publish.mock.calls[0]?.[0]?.value ?? '');

    expect(event).not.toHaveProperty('trigger');
    expect(event).not.toHaveProperty('parent_id');
  });

  it('lists by origin, so a scheduled run is distinguishable from one asked for', async () => {
    await analyses.start({ analysis: 'data_refresh', trigger: 'manual' });
    const scheduled = await analyses.start({ analysis: 'full_pipeline', trigger: 'scheduled' });

    const listed = await analyses.list({ trigger: 'scheduled', limit: 50 });

    expect(listed.map(row => row.id)).toEqual([scheduled.id]);
  });

  it('mints a fresh id per call', async () => {
    const first = await analyses.start({ analysis: 'data_quality_check' });
    const second = await analyses.start({ analysis: 'data_quality_check' });

    expect(first.id).not.toBe(second.id);
  });

  it('carries volume_forecast split dates into the trigger.ml event', async () => {
    const request = {
      analysis: 'volume_forecast' as const,
      tenant_id: 'locaweb',
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
    const publish = vi.fn(async (_message: OutboundMessage) => undefined);
    const analyses = new AnalysesService(memoryPrisma(), { publish }, topics);
    const started = await analyses.start({ analysis: 'data_refresh' });
    const status = {
      status: 'running' as const,
      started_at: new Date('2026-08-15T12:30:00Z'),
    };

    await analyses.update(started.id, status, updateKeyFrom(publish));

    expect(await analyses.getStatus(started.id)).toEqual({
      id: started.id,
      analysis: 'data_refresh',
      trigger: 'manual',
      ...status,
    });
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

  it('rejects moving status backwards — succeeded cannot become running', async () => {
    const publish = vi.fn(async (_message: OutboundMessage) => undefined);
    const analyses = new AnalysesService(memoryPrisma(), { publish }, topics);
    const started = await analyses.start({ analysis: 'data_refresh' });
    const key = updateKeyFrom(publish);

    await analyses.update(started.id, { status: 'running' }, key);
    await analyses.update(started.id, { status: 'succeeded' }, key);

    await expect(analyses.update(started.id, { status: 'running' }, key)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('rejects swapping a terminal status for the other', async () => {
    const publish = vi.fn(async (_message: OutboundMessage) => undefined);
    const analyses = new AnalysesService(memoryPrisma(), { publish }, topics);
    const started = await analyses.start({ analysis: 'data_refresh' });
    const key = updateKeyFrom(publish);

    await analyses.update(started.id, { status: 'failed' }, key);

    await expect(analyses.update(started.id, { status: 'succeeded' }, key)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
