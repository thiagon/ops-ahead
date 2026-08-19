import { z } from 'zod';

/**
 * Business-language contract only — no Kafka/Kubernetes vocabulary ever
 * appears here. Identical to the original trigger-service contract except
 * for one removal: no `data_source` override (SSRF/credential-leak risk —
 * see conductor/tracks/exec-trigger_20260807/payloads.md).
 */
const splitDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const volumeForecastRequestSchema = z
  .object({
    analysis: z.literal('volume_forecast'),
    train_end: splitDate,
    validation_end: splitDate,
    holdout_end: splitDate,
  })
  .strict()
  .meta({ id: 'VolumeForecastRequest' });

export const breachRiskRequestSchema = z
  .object({
    analysis: z.literal('breach_risk'),
    train_end: splitDate,
    validation_end: splitDate,
    holdout_end: splitDate,
  })
  .strict()
  .meta({ id: 'BreachRiskRequest' });

export const kpiProjectionRequestSchema = z
  .object({
    analysis: z.literal('kpi_projection'),
    // All optional — the trainer's own configured defaults apply when omitted.
    n_simulations: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
    kpi_target_volume_p2: z.number().int().nonnegative().optional(),
    kpi_target_volume_p3: z.number().int().nonnegative().optional(),
    kpi_target_breaches_p2: z.number().int().nonnegative().optional(),
    kpi_target_breaches_p3: z.number().int().nonnegative().optional(),
  })
  .strict()
  .meta({ id: 'KpiProjectionRequest' });

export const externalEventDetectionRequestSchema = z
  .object({
    analysis: z.literal('external_event_detection'),
    // Expected share of days flagged anomalous — the trainer's own
    // configured default applies when omitted.
    contamination: z.number().min(0).max(0.5).optional(),
  })
  .strict()
  .meta({ id: 'ExternalEventDetectionRequest' });

export const dataRefreshRequestSchema = z
  .object({ analysis: z.literal('data_refresh') })
  .strict()
  .meta({ id: 'DataRefreshRequest' });

export const dataQualityCheckRequestSchema = z
  .object({ analysis: z.literal('data_quality_check') })
  .strict()
  .meta({ id: 'DataQualityCheckRequest' });

export const triggerRequestSchema = z
  .discriminatedUnion('analysis', [
    volumeForecastRequestSchema,
    breachRiskRequestSchema,
    kpiProjectionRequestSchema,
    externalEventDetectionRequestSchema,
    dataRefreshRequestSchema,
    dataQualityCheckRequestSchema,
  ])
  .meta({
    id: 'TriggerRequest',
    description: 'A business analysis run, discriminated by `analysis`',
  });

export type TriggerRequest = z.infer<typeof triggerRequestSchema>;

export const triggerAcceptedSchema = z
  .object({ run_id: z.uuid() })
  .meta({ id: 'TriggerAccepted', description: 'The bus owns the request now' });

export const triggerErrorSchema = z
  .object({
    error: z.string().meta({ description: 'Machine-readable error name' }),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: 'Which fields broke the contract, when the body was the problem' }),
  })
  .meta({ id: 'TriggerErrorResponse' });
