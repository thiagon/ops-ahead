import { getConfig } from './config.server.ts';
import type { ShapContribution } from './types.ts';

export type { ShapContribution } from './types.ts';

/** Mirrors `BreachFeatureInput` in apps/ml-model-serving/src/schemas.py. */
export interface BreachFeatureInput {
  severity: number;
  owner: string;
  opened_hour: number;
  opened_dayofweek: number;
  is_manual_open: number;
  p4_precursor_present: number;
  p4_precursor_length: number;
  no_intervention_count_1h: number;
  no_intervention_count_6h: number;
  group_load: number;
  was_recategorized: number;
  recategorization_count: number;
  group_severity_historical_ola_ratio: number | null;
  group_severity_historical_over_25pct_rate: number | null;
  consumed_ratio: number;
  time_remaining_seconds: number;
  was_acknowledged: number;
  entity_signal_count_15m: number;
  entity_signal_count_1h: number;
  entity_auto_resolution_rate: number | null;
  entity_severity_escalations: number;
}

export interface BreachPrediction {
  breach_probability: number;
  shap_top5: ShapContribution[];
}

export type ScoreBreach = (features: BreachFeatureInput) => Promise<BreachPrediction | null>;

export async function predictBreach(features: BreachFeatureInput): Promise<BreachPrediction> {
  const config = getConfig();
  const response = await fetch(new URL('/predict/breach', config.ML_MODEL_SERVING_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(features),
    signal: AbortSignal.timeout(config.ML_MODEL_SERVING_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`ml-model-serving answered ${response.status}`);
  }
  return (await response.json()) as BreachPrediction;
}
