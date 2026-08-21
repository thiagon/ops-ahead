import type { BreachContextRow, OpenAlertRow } from './clickhouse.server.ts';
import { fetchBreachContext, fetchOpenAlerts, OPEN_ALERTS_SQL } from './clickhouse.server.ts';
import type { BreachFeatureInput, ScoreBreach } from './model-serving.server.ts';
import { predictBreach } from './model-serving.server.ts';

/** One row of the operator queue, as the screen consumes it. */
export interface QueueRow {
  source: string;
  external_id: string;
  severity: number;
  status: string;
  title: string;
  owner: string;
  entity_id: string | null;
  opened_at: string;
  due_at: string;
  deadline_seconds: number;
  consumed_ratio: number;
  time_remaining_seconds: number;
  has_breached: boolean;
  is_eligible: boolean;
  acknowledged: boolean;
  severity_changes: number;
  /** null when ml-model-serving did not answer — consumed_ratio still stands. */
  breach_probability: number | null;
}

export interface BuildQueueOptions {
  query: (sql: string, params: Record<string, unknown>) => Promise<OpenAlertRow[]>;
  score: ScoreBreach;
  context?: Record<string, BreachContextRow>;
  now?: Date;
}

/**
 * ClickHouse's DateTime renders without a zone over JSONEachRow; the column is
 * stored in UTC, so the `Z` has to be put back before Date parses it as local
 * time.
 */
export function parseClickHouseDate(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

export function occurrenceKey(source: string, externalId: string): string {
  return `${source} ${externalId}`;
}

export function buildBreachFeatures(
  row: OpenAlertRow,
  context: BreachContextRow | undefined,
  now: Date,
): BreachFeatureInput {
  const openedAt = parseClickHouseDate(row.opened_at);
  const dueAt = parseClickHouseDate(row.due_at);
  const precursorLength = context?.p4_precursor_length ?? 0;

  return {
    severity: row.severity,
    owner: row.owner,
    opened_hour: openedAt.getUTCHours(),
    // Python's dayofweek is Monday=0; JS getUTCDay is Sunday=0.
    opened_dayofweek: (openedAt.getUTCDay() + 6) % 7,
    is_manual_open: row.reported_by === 'manual' ? 1 : 0,
    p4_precursor_present: precursorLength > 0 ? 1 : 0,
    p4_precursor_length: precursorLength,
    no_intervention_count_1h: context?.no_intervention_count_1h ?? 0,
    no_intervention_count_6h: context?.no_intervention_count_6h ?? 0,
    group_load: context?.group_load ?? 0,
    was_recategorized: row.severity_changes > 0 ? 1 : 0,
    recategorization_count: row.severity_changes,
    // Nullable in the model's own schema — "no prior history for this owner +
    // severity" is a value it was trained to receive, not a missing feature.
    group_severity_historical_ola_ratio: context?.group_severity_historical_ola_ratio ?? null,
    group_severity_historical_over_25pct_rate:
      context?.group_severity_historical_over_25pct_rate ?? null,
    consumed_ratio: row.consumed_ratio ?? 0,
    time_remaining_seconds: (dueAt.getTime() - now.getTime()) / 1000,
    was_acknowledged: row.acknowledged_at === null ? 0 : 1,
    entity_signal_count_15m: context?.entity_signal_count_15m ?? 0,
    entity_signal_count_1h: context?.entity_signal_count_1h ?? 0,
    entity_auto_resolution_rate: context?.entity_auto_resolution_rate ?? null,
    entity_severity_escalations: context?.entity_severity_escalations ?? 0,
  };
}

export function toQueueRow(row: OpenAlertRow, now: Date): Omit<QueueRow, 'breach_probability'> {
  const dueAt = parseClickHouseDate(row.due_at);
  return {
    source: row.source,
    external_id: row.external_id,
    severity: row.severity,
    status: row.status,
    title: row.title,
    owner: row.owner,
    entity_id: row.entity_id,
    opened_at: row.opened_at,
    due_at: row.due_at,
    deadline_seconds: row.deadline_seconds,
    consumed_ratio: row.consumed_ratio ?? 0,
    time_remaining_seconds: (dueAt.getTime() - now.getTime()) / 1000,
    has_breached: row.has_breached === 1,
    is_eligible: row.is_eligible === 1,
    acknowledged: row.acknowledged_at !== null,
    severity_changes: row.severity_changes,
  };
}

/**
 * The queue, in the order `silver_alert_open` returned it. The score is an
 * additive signal: every failure to obtain one leaves that row's
 * `breach_probability` null and the row itself intact, so the screen still
 * ranks by the deadline actually consumed.
 */
export async function buildQueue(options: BuildQueueOptions): Promise<QueueRow[]> {
  const { query, score, context = {}, now = new Date() } = options;
  const rows = await query(OPEN_ALERTS_SQL, {});

  return await Promise.all(
    rows.map(async row => {
      const base = toQueueRow(row, now);
      let breach_probability: number | null = null;
      try {
        const features = buildBreachFeatures(
          row,
          context[occurrenceKey(row.source, row.external_id)],
          now,
        );
        breach_probability = (await score(features))?.breach_probability ?? null;
      } catch {
        breach_probability = null;
      }
      return { ...base, breach_probability };
    }),
  );
}

/** The queue as the route loader builds it, against the real dependencies. */
export async function loadQueue(limit = 200): Promise<QueueRow[]> {
  const rows = await fetchOpenAlerts(limit);
  // A failure here is the same class as a serving failure: the queue renders
  // without a score rather than not at all.
  const context = await fetchBreachContext().catch(() => ({}));

  const now = new Date();
  return await buildQueue({
    query: async () => rows,
    score: predictBreach,
    context,
    now,
  });
}
