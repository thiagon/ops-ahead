/**
 * Types shared between server-only modules and plain components. Kept out of
 * any `*.server.ts` file so a component can import them without pulling in
 * the ClickHouse/model-serving client code — see test/server-only.test.ts.
 */

export interface ShapContribution {
  feature: string;
  shap_value: number;
}

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
  /** null on the same failure as breach_probability. */
  shap_top5: ShapContribution[] | null;
}

/** A deadline milestone this occurrence already crossed. */
export interface MilestoneRow {
  kind: string;
  severity: number;
  due_at: string;
  deadline_seconds: number;
  consumed_ratio: number;
  occurred_at: string;
}

/** One severity transition, from `priority_changes_log`. */
export interface SeverityChangeRow {
  received_at: string;
  severity_from: number;
  severity_to: number;
}

/** A closed occurrence with the same owner + severity, from gold_alert_breach_consolidation. */
export interface SimilarIncidentRow {
  source: string;
  external_id: string;
  owner: string;
  severity: number;
  duration_seconds: number;
  deadline_seconds: number;
  has_breached: number;
  closed_at: string;
}
