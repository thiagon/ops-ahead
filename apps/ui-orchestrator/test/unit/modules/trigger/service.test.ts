import { beforeEach, describe, expect, it, vi } from 'vitest';
import { topicForAnalysis, triggerAnalysis } from '../../../../src/modules/trigger/service.ts';
import type { OutboundMessage } from '../../../../src/plugins/kafka.ts';

const env = { KAFKA_TOPIC_ML: 'trigger.ml', KAFKA_TOPIC_DATA: 'trigger.data' };

describe('topicForAnalysis', () => {
  it.each([
    ['volume_forecast', 'trigger.ml'],
    ['breach_risk', 'trigger.ml'],
    ['data_refresh', 'trigger.data'],
    ['data_quality_check', 'trigger.data'],
  ] as const)(
    'routes %s to %s — no vocabulary translation, just topic choice',
    (analysis, topic) => {
      expect(topicForAnalysis(analysis, { env })).toBe(topic);
    },
  );
});

describe('triggerAnalysis', () => {
  let publish: (topic: string, message: OutboundMessage) => Promise<void>;
  let app: { env: typeof env; kafka: { publish: typeof publish } };

  beforeEach(() => {
    publish = vi.fn(async () => undefined);
    app = { env, kafka: { publish } };
  });

  it('mints a run_id and publishes the request, `analysis` intact, to the routed topic', async () => {
    const result = await triggerAnalysis(app, { analysis: 'data_refresh' });

    expect(result.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(publish).toHaveBeenCalledWith('trigger.data', {
      key: result.run_id,
      value: JSON.stringify({ run_id: result.run_id, analysis: 'data_refresh' }),
    });
  });

  it('mints a fresh run_id per call', async () => {
    const first = await triggerAnalysis(app, { analysis: 'data_quality_check' });
    const second = await triggerAnalysis(app, { analysis: 'data_quality_check' });

    expect(first.run_id).not.toBe(second.run_id);
  });

  it('carries volume_forecast split dates into the trigger.ml event', async () => {
    const request = {
      analysis: 'volume_forecast' as const,
      train_end: '2025-09-30',
      validation_end: '2025-10-31',
      holdout_end: '2026-01-31',
    };

    const result = await triggerAnalysis(app, request);

    expect(publish).toHaveBeenCalledWith('trigger.ml', {
      key: result.run_id,
      value: JSON.stringify({ run_id: result.run_id, ...request }),
    });
  });
});
