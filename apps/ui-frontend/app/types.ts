/**
 * Types shared between server-only modules and plain components. Kept out of
 * any `*.server.ts` file so a component can import them without pulling in
 * the ClickHouse/model-serving client code — see test/server-only.test.ts.
 */

export interface ShapContribution {
  feature: string;
  shap_value: number;
}

/** One row per target_date × priority_group × horizon (D+1 and D+7). */
export interface VolumeForecastRow {
  target_date: string;
  priority_group: string;
  horizon: number;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
}

/**
 * The signals the breach model reads beyond `silver_alert_open` — owner load,
 * the entity's monitor-chain activity, and this owner+severity's historical
 * OLA behavior. No copilot exists yet to call tools against them; the drill-down
 * shows this as "signals considered" instead of a mocked tool call.
 */
export interface BreachSignals {
  group_load: number;
  entity_signal_count_15m: number;
  entity_signal_count_1h: number;
  entity_auto_resolution_rate: number | null;
  entity_severity_escalations: number;
  group_severity_historical_ola_ratio: number | null;
  no_intervention_count_1h: number;
  no_intervention_count_6h: number;
  p4_precursor_length: number;
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
  /** null when no breach-context row exists for this owner + entity yet. */
  breach_signals: BreachSignals | null;
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
  title: string;
  entity_id: string | null;
  duration_seconds: number;
  deadline_seconds: number;
  has_breached: number;
  closed_at: string;
}
