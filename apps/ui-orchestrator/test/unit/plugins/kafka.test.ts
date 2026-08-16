import { describe, expect, it } from 'vitest';
import { backlogTargets } from '../../../src/plugins/kafka.ts';

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
