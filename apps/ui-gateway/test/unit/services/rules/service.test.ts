import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from '../../../../src/plugins/kafka.ts';
import { RulesService } from '../../../../src/services/rules/index.ts';

const topics = {
  mapping: 'rules.mapping',
  deadline: 'rules.deadline',
  target: 'rules.target',
};

describe('RulesService.setMapping', () => {
  let publish: ReturnType<typeof vi.fn<(message: OutboundMessage) => Promise<void>>>;
  let rules: RulesService;

  beforeEach(() => {
    publish = vi.fn(async (_message: OutboundMessage) => undefined);
    rules = new RulesService({ publish }, topics);
  });

  it('publishes bindings and dictionary as one record keyed tenant:source', async () => {
    const result = await rules.setMapping('locaweb', 'service_now', {
      intake: 'alert',
      dictionary_version: 'v1',
      bindings: [{ field: 'status', path: 'fields.status' }],
      mappings: { status: { Aberto: 'open' } },
    });

    expect(result).toEqual({ key: 'locaweb:service_now', topic: 'rules.mapping' });
    expect(publish).toHaveBeenCalledTimes(1);

    const record = JSON.parse(publish.mock.calls[0]?.[0]?.value ?? '');
    expect(record).toMatchObject({
      tenant_id: 'locaweb',
      source: 'service_now',
      dictionary_version: 'v1',
    });
    expect(record.bindings).toHaveLength(1);
    expect(record.mappings.status).toEqual({ Aberto: 'open' });
  });
});

describe('RulesService.setDeadlines', () => {
  it('publishes keyed by tenant alone', async () => {
    const publish = vi.fn(async (_message: OutboundMessage) => undefined);
    const rules = new RulesService({ publish }, topics);

    const result = await rules.setDeadlines('locaweb', {
      deadlines: [{ severity: 1, deadline_seconds: 14400 }],
    });

    expect(result).toEqual({ key: 'locaweb', topic: 'rules.deadline' });
    const message = publish.mock.calls[0]?.[0];
    expect(JSON.parse(message?.value ?? '')).toMatchObject({ tenant_id: 'locaweb' });
  });
});

describe('RulesService.setTargets', () => {
  it('publishes severities as given, never a kpi_group label', async () => {
    const publish = vi.fn(async (_message: OutboundMessage) => undefined);
    const rules = new RulesService({ publish }, topics);

    const result = await rules.setTargets('locaweb', {
      targets: [{ severities: [1, 2], max_breaches: 5, achievement_pct: 95 }],
    });

    expect(result).toEqual({ key: 'locaweb', topic: 'rules.target' });
    const message = publish.mock.calls[0]?.[0];
    const record = JSON.parse(message?.value ?? '');
    expect(record.targets[0]).toMatchObject({ severities: [1, 2] });
    expect(record.targets[0]).not.toHaveProperty('kpi_group');
  });
});
