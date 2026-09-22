import { describe, expect, it } from 'vitest';
import { isMissingClickHouseTable } from '../app/clickhouse.server.ts';

describe('ClickHouse table availability', () => {
  it('recognizes the missing mart error returned by ClickHouse', () => {
    expect(
      isMissingClickHouseTable(
        new Error("Unknown table expression identifier 'priority_changes_log' in scope SELECT"),
      ),
    ).toBe(true);
  });

  it('does not hide unrelated ClickHouse failures', () => {
    expect(
      isMissingClickHouseTable(new Error('Code: 159. DB::Exception: Timeout exceeded')),
    ).toBe(false);
  });
});
