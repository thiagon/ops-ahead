import { describe, expect, it } from 'vitest';
import { getRunStatus } from '../../../../src/modules/runs/service.ts';

describe('getRunStatus', () => {
  it('reports "queued" when no status has arrived yet — not an error', () => {
    const app = { runStatus: { get: () => undefined } };

    expect(getRunStatus(app, 'unknown-run')).toEqual({ run_id: 'unknown-run', status: 'queued' });
  });

  it('passes through whatever the store last received, unmodified', () => {
    const stored = {
      run_id: 'run-1',
      status: 'Running' as const,
      started_at: '2026-08-15T12:30:00Z',
    };
    const app = { runStatus: { get: () => stored } };

    expect(getRunStatus(app, 'run-1')).toBe(stored);
  });
});
