import { z } from 'zod';

export const ANALYSIS_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

/**
 * Where the request came from. The gateway decides it from how the request
 * arrived, never from the body — a caller that could declare its own origin
 * would empty the column of meaning.
 */
export const ANALYSIS_TRIGGERS = ['manual', 'scheduled', 'chained'] as const;

export const analysisTriggerSchema = z.enum(ANALYSIS_TRIGGERS);

export type AnalysisTrigger = z.infer<typeof analysisTriggerSchema>;

export const analysisStatusValueSchema = z.enum(ANALYSIS_STATUSES);

export type AnalysisStatusValue = z.infer<typeof analysisStatusValueSchema>;

const isoDatetime = z.codec(z.iso.datetime(), z.date(), {
  decode: iso => new Date(iso),
  encode: date => date.toISOString(),
});

export const analysisStatusSchema = z
  .object({
    id: z.string(),
    analysis: z.string().optional(),
    trigger: analysisTriggerSchema.optional(),
    parent_id: z.string().optional(),
    status: analysisStatusValueSchema,
    started_at: isoDatetime.optional(),
    finished_at: isoDatetime.optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .meta({ id: 'AnalysisStatus' });

export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

export const analysisStatusUpdateSchema = analysisStatusSchema
  .omit({ id: true, analysis: true, trigger: true, parent_id: true })
  .meta({ id: 'AnalysisStatusUpdate' });

export type AnalysisStatusUpdate = z.infer<typeof analysisStatusUpdateSchema>;

export const analysisParamsSchema = z.object({
  id: z.string().min(1),
});

export const analysisListQuerySchema = z.object({
  trigger: analysisTriggerSchema.optional(),
  analysis: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
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

/**
 * Optional on every analysis: a caller that says nothing is a person asking
 * for it, which is what `manual` means. The CronJob and data-runner's chaining
 * declare theirs so a run's origin is queryable instead of inferred.
 */
const provenance = {
  trigger: analysisTriggerSchema.default('manual'),
  parent_id: z.string().min(1).optional(),
};

export const volumeForecastRequestSchema = z
  .object({
    analysis: z.literal('volume_forecast'),
    ...provenance,
    train_end: splitDate,
    validation_end: splitDate,
    holdout_end: splitDate,
  })
  .strict()
  .meta({ id: 'VolumeForecastRequest' });

export const breachRiskRequestSchema = z
  .object({
    analysis: z.literal('breach_risk'),
    ...provenance,
    train_end: splitDate,
    validation_end: splitDate,
    holdout_end: splitDate,
  })
  .strict()
  .meta({ id: 'BreachRiskRequest' });

export const kpiProjectionRequestSchema = z
  .object({
    analysis: z.literal('kpi_projection'),
    ...provenance,
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
    ...provenance,
    contamination: z.number().min(0).max(0.5).optional(),
  })
  .strict()
  .meta({ id: 'ExternalEventDetectionRequest' });

export const entityForecastRequestSchema = z
  .object({
    analysis: z.literal('entity_forecast'),
    ...provenance,
    train_end: splitDate,
    validation_end: splitDate,
    holdout_end: splitDate,
  })
  .strict()
  .meta({ id: 'EntityForecastRequest' });

export const dataRefreshRequestSchema = z
  .object({ analysis: z.literal('data_refresh'), ...provenance })
  .strict()
  .meta({ id: 'DataRefreshRequest' });

export const dataQualityCheckRequestSchema = z
  .object({ analysis: z.literal('data_quality_check'), ...provenance })
  .strict()
  .meta({ id: 'DataQualityCheckRequest' });

/**
 * The whole daily chain: transform, validate, then the trainings data-runner
 * chains off it. Accepted on the route because the CronJob reaches the gateway
 * like any other client — there is no second, invisible way in.
 */
export const fullPipelineRequestSchema = z
  .object({ analysis: z.literal('full_pipeline'), ...provenance })
  .strict()
  .meta({ id: 'FullPipelineRequest' });

export const analysisRequestSchema = z
  .discriminatedUnion('analysis', [
    volumeForecastRequestSchema,
    entityForecastRequestSchema,
    breachRiskRequestSchema,
    kpiProjectionRequestSchema,
    externalEventDetectionRequestSchema,
    dataRefreshRequestSchema,
    dataQualityCheckRequestSchema,
    fullPipelineRequestSchema,
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
