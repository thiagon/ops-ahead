import { describe, expect, it } from 'vitest';
import { backlogTargets, parseStatusMessage } from '../../../src/plugins/kafka.ts';

describe('backlogTargets', () => {
  it('targets the last written offset per partition (watermark - 1)', () => {
    const targets = backlogTargets([5n, 3n]);

    expect(targets).toEqual(
      new Map([
        [0, 4n],
        [1, 2n],
      ]),
    );
  });

  it('excludes a partition that has never had a message', () => {
    const targets = backlogTargets([0n, 3n]);

    expect(targets).toEqual(new Map([[1, 2n]]));
  });

  it('returns an empty map when every partition is empty', () => {
    expect(backlogTargets([0n, 0n])).toEqual(new Map());
  });

  it('returns an empty map for a topic with no partitions', () => {
    expect(backlogTargets([])).toEqual(new Map());
  });
});

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
