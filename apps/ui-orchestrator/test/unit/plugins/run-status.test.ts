import { describe, expect, it } from 'vitest';
import { parseStatusMessage, RunsService } from '../../../src/plugins/run-status.ts';

describe('parseStatusMessage', () => {
  it('parses a well-formed status message', () => {
    const raw = Buffer.from(JSON.stringify({ run_id: 'run-1', status: 'Running' }));

    expect(parseStatusMessage(raw)).toEqual({ run_id: 'run-1', status: 'Running' });
  });

  it('returns undefined for invalid JSON — never throws', () => {
    expect(parseStatusMessage(Buffer.from('not json'))).toBeUndefined();
  });

  it('returns undefined when run_id is missing', () => {
    expect(parseStatusMessage(Buffer.from(JSON.stringify({ status: 'Running' })))).toBeUndefined();
  });

  it('returns undefined when run_id is not a string', () => {
    const raw = Buffer.from(JSON.stringify({ run_id: 123, status: 'Running' }));

    expect(parseStatusMessage(raw)).toBeUndefined();
  });

  it('returns undefined for an undefined buffer', () => {
    expect(parseStatusMessage(undefined)).toBeUndefined();
  });
});

describe('RunsService', () => {
  it('reports "queued" when no status has arrived yet — not an error', () => {
    const service = new RunsService();

    expect(service.getStatus('unknown-run')).toEqual({ run_id: 'unknown-run', status: 'queued' });
  });

  it('reflects whatever recordStatus last stored for that run', () => {
    const service = new RunsService();
    const status = {
      run_id: 'run-1',
      status: 'Running' as const,
      started_at: '2026-08-15T12:30:00Z',
    };
    service.recordStatus(status);

    expect(service.getStatus('run-1')).toEqual(status);
  });
});
