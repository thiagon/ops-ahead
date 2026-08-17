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
