import { describe, expect, it, vi } from 'vitest';
import type { OpenAlertRow } from '../app/clickhouse.server.ts';
import { buildQueue } from '../app/queue.server.ts';

function openAlertRow(overrides: Partial<OpenAlertRow> = {}): OpenAlertRow {
  return {
    tenant_id: 'locaweb',
    source: 'itsm',
    external_id: 'INC-1',
    severity: 3,
    status: 'in_progress',
    entity_id: 'srv-01',
    title: 'Banco de dados lento',
    owner: 'infra',
    reported_by: 'monitor',
    opened_at: '2026-08-21 08:00:00',
    acknowledged_at: '2026-08-21 08:05:00',
    due_at: '2026-08-21 20:00:00',
    deadline_seconds: 43200,
    consumed_ratio: 0.8,
    has_breached: 0,
    is_eligible: 1,
    severity_changes: 1,
    ...overrides,
  };
}

describe('open occurrence queue', () => {
  it('reads silver_alert_open ordered by due_at', async () => {
    const query = vi.fn(async (_sql: string, _params: Record<string, unknown>) => [openAlertRow()]);

    await buildQueue({ query, score: async () => null });

    const sql = query.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('silver_alert_open');
    expect(sql).not.toMatch(/from\s+silver_alert\b/);
    expect(sql).toMatch(/order by\s+due_at asc/i);
  });

  it('carries consumed_ratio, the current severity and acknowledgment', async () => {
    const query = vi.fn(async () => [
      openAlertRow({
        external_id: 'INC-9',
        severity: 2,
        consumed_ratio: 0.42,
        acknowledged_at: null,
      }),
    ]);

    const queue = await buildQueue({ query, score: async () => null });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      external_id: 'INC-9',
      severity: 2,
      consumed_ratio: 0.42,
      acknowledged: false,
    });
  });

  it('keeps the row order the query returned — soonest deadline first', async () => {
    const query = vi.fn(async () => [
      openAlertRow({ external_id: 'INC-SOON', due_at: '2026-08-21 09:00:00' }),
      openAlertRow({ external_id: 'INC-LATER', due_at: '2026-08-21 23:00:00' }),
    ]);

    const queue = await buildQueue({ query, score: async () => null });

    expect(queue.map(row => row.external_id)).toEqual(['INC-SOON', 'INC-LATER']);
  });
});

describe('breach risk score', () => {
  it('comes from ml-model-serving, next to consumed_ratio and not replacing it', async () => {
    const query = vi.fn(async () => [openAlertRow({ consumed_ratio: 0.9 })]);
    const score = vi.fn(async () => ({ breach_probability: 0.73, shap_top5: [] }));

    const queue = await buildQueue({ query, score });

    expect(score).toHaveBeenCalledTimes(1);
    expect(queue[0]?.breach_probability).toBe(0.73);
    expect(queue[0]?.consumed_ratio).toBe(0.9);
  });

  it('fails open when ml-model-serving does not respond', async () => {
    const query = vi.fn(async () => [
      openAlertRow({ external_id: 'INC-A', consumed_ratio: 0.3 }),
      openAlertRow({ external_id: 'INC-B', consumed_ratio: 0.95 }),
    ]);
    const score = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED ml-model-serving.ml.svc.cluster.local:3000');
    });

    const queue = await buildQueue({ query, score });

    expect(queue.map(row => row.external_id)).toEqual(['INC-A', 'INC-B']);
    expect(queue.map(row => row.consumed_ratio)).toEqual([0.3, 0.95]);
    expect(queue.every(row => row.breach_probability === null)).toBe(true);
  });

  it('keeps the rows scored before a later failure', async () => {
    const query = vi.fn(async () => [
      openAlertRow({ external_id: 'INC-A' }),
      openAlertRow({ external_id: 'INC-B' }),
    ]);
    const score = vi
      .fn()
      .mockResolvedValueOnce({ breach_probability: 0.5, shap_top5: [] })
      .mockRejectedValueOnce(new Error('timeout'));

    const queue = await buildQueue({ query, score });

    expect(queue[0]?.breach_probability).toBe(0.5);
    expect(queue[1]?.breach_probability).toBeNull();
  });
});
