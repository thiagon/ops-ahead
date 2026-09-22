import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboundMessage } from '../../../../src/lib/kafka.ts';
import { HISTORY_LIMIT, RulesService } from '../../../../src/services/rules/index.ts';
import { memoryPrisma } from '../../../helpers/app.ts';
import { alertMapping } from '../../../helpers/mapping.ts';

const topics = {
  mapping: 'rules.mapping',
  deadline: 'rules.deadline',
  target: 'rules.target',
};

const mapping = alertMapping;

function build() {
  const publish = vi.fn(async (_message: OutboundMessage) => undefined);
  return { publish, rules: new RulesService({ publish, publishBatch: async () => undefined }, topics, memoryPrisma()) };
}

describe('RulesService.setMapping', () => {
  let publish: ReturnType<typeof vi.fn<(message: OutboundMessage) => Promise<void>>>;
  let rules: RulesService;

  beforeEach(() => {
    ({ publish, rules } = build());
  });

  it('publishes bindings and dictionary as one record keyed tenant:source', async () => {
    const result = await rules.setMapping('locaweb', 'itsm', mapping);

    expect(result).toEqual({ key: 'locaweb:itsm', topic: 'rules.mapping' });
    expect(publish).toHaveBeenCalledTimes(1);

    const record = JSON.parse(publish.mock.calls[0]?.[0]?.value ?? '');
    expect(record).toMatchObject({
      tenant_id: 'locaweb',
      source: 'itsm',
      version: 'v1',
    });
    expect(record.bindings.status).toBe('fields.status');
    expect(record.bindings.external_id).toBe('payload.ticket_number');
    expect(record.mappings.status).toEqual({ Aberto: 'open' });
  });

  it('rejects a mapping for a source that is not registered', async () => {
    const { publish, rules } = build();

    await expect(rules.setMapping('locaweb', 'service_now', mapping)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('RulesService.setDeadlines', () => {
  it('publishes keyed by tenant alone', async () => {
    const { publish, rules } = build();

    const result = await rules.setDeadlines('locaweb', {
      deadlines: [{ severity: 1, seconds: 14400 }],
    });

    expect(result).toEqual({ key: 'locaweb', topic: 'rules.deadline' });
    const message = publish.mock.calls[0]?.[0];
    expect(JSON.parse(message?.value ?? '')).toMatchObject({ tenant_id: 'locaweb' });
  });
});

describe('RulesService.setTargets', () => {
  it('publishes severities as given, never a kpi_group label', async () => {
    const { publish, rules } = build();

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

describe('history', () => {
  it('returns the published document on GET after PUT', async () => {
    const { rules } = build();
    const body = { deadlines: [{ severity: 1, seconds: 14400 }] };
    await rules.setDeadlines('locaweb', body);

    expect(await rules.getDeadlines('locaweb')).toEqual(body);
  });

  it('GET history lists the last ten even when more copies are stored', async () => {
    const { rules } = build();
    for (let seconds = 1; seconds <= HISTORY_LIMIT + 1; seconds += 1) {
      await rules.setDeadlines('locaweb', { deadlines: [{ severity: 1, seconds }] });
    }

    const history = await rules.listDeadlineHistory('locaweb');
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(await rules.getDeadlines('locaweb')).toEqual({
      deadlines: [{ severity: 1, seconds: HISTORY_LIMIT + 1 }],
    });
    expect(history[0]?.deadlines[0]?.seconds).toBe(HISTORY_LIMIT + 1);
    expect(history.at(-1)?.deadlines[0]?.seconds).toBe(2);
  });
});
