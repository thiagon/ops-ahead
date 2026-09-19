import { z } from 'zod';

export const ANALYSIS_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

export const analysisStatusValueSchema = z.enum(ANALYSIS_STATUSES);

export type AnalysisStatusValue = z.infer<typeof analysisStatusValueSchema>;

const isoDatetime = z.codec(z.iso.datetime(), z.date(), {
  decode: iso => new Date(iso),
  encode: date => date.toISOString(),
});

export const analysisStatusSchema = z
  .object({
    id: z.string(),
    status: analysisStatusValueSchema,
    started_at: isoDatetime.optional(),
    finished_at: isoDatetime.optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'AnalysisStatus' });

export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

export const analysisStatusUpdateSchema = analysisStatusSchema
  .omit({ id: true })
  .meta({ id: 'AnalysisStatusUpdate' });

export type AnalysisStatusUpdate = z.infer<typeof analysisStatusUpdateSchema>;

export const analysisParamsSchema = z.object({
  id: z.string().min(1),
});

export const analysisUpdateHeadersSchema = z.object({
  'x-update-key': z.string().min(1).meta({
    description: 'Credential from the Kafka message for this run — never returned on HTTP 202',
  }),
});

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

export const analysisRequestSchema = z
  .discriminatedUnion('analysis', [
    volumeForecastRequestSchema,
    breachRiskRequestSchema,
    kpiProjectionRequestSchema,
    externalEventDetectionRequestSchema,
    dataRefreshRequestSchema,
    dataQualityCheckRequestSchema,
  ])
  .meta({
    id: 'AnalysisRequest',
    description: 'A business analysis, discriminated by `analysis`',
  });

export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

export const analysisAcceptedSchema = z
  .object({ id: z.uuid() })
  .meta({ id: 'AnalysisAccepted', description: 'The bus owns the request now' });

export const analysisErrorSchema = z
  .object({
    error: z.string().meta({ description: 'Machine-readable error name' }),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: 'Which fields broke the contract, when the body was the problem' }),
  })
  .meta({ id: 'AnalysisErrorResponse' });
