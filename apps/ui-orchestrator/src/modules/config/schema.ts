import { z } from 'zod';

/**
 * The configuration the screens edit. Mirrors what today lives as files next
 * to the consumers — the translation dictionary, the dbt seeds, and the
 * gateway's origin registry — and what contracts/field-binding.schema.json and
 * contracts/translation-dictionary.schema.json declare on the wire.
 */

export const intakeSchema = z.enum(['alert', 'monitor']);
export type Intake = z.infer<typeof intakeSchema>;

export const mappingFieldSchema = z.enum([
  'status',
  'severity',
  'reported_by',
  'resolution_code',
  'condition',
]);
export type MappingField = z.infer<typeof mappingFieldSchema>;

export const tenantParamsSchema = z.object({
  tenant: z.string().min(1),
});

export const sourceParamsSchema = tenantParamsSchema.extend({
  source: z.string().min(1),
});

const fieldBindingSchema = z
  .object({
    field: z.string().min(1),
    path: z.string().min(1).nullable(),
  })
  .meta({ id: 'FieldBinding' });

const mappingEntrySchema = z
  .object({
    id: z.uuid(),
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .meta({ id: 'MappingEntry' });

export const integrationSchema = z
  .object({
    source: z.string(),
    intake: intakeSchema,
    envelopeVersion: z.string(),
    secretCreatedAt: z.string().nullable(),
    enabled: z.boolean(),
    dictionaryVersion: z.string().nullable(),
    dictionaryStatus: z.enum(['published', 'draft']).nullable(),
    bindings: z.array(fieldBindingSchema),
    mappings: z.partialRecord(mappingFieldSchema, z.array(mappingEntrySchema)),
  })
  .meta({ id: 'Integration' });

export type Integration = z.infer<typeof integrationSchema>;

export const integrationListSchema = z
  .object({ items: z.array(integrationSchema) })
  .meta({ id: 'IntegrationList' });

export const deadlineSchema = z
  .object({
    severity: z.number().int().min(1).max(5),
    deadlineSeconds: z.number().int().positive(),
  })
  .meta({ id: 'Deadline' });

export type Deadline = z.infer<typeof deadlineSchema>;

export const deadlineListSchema = z
  .object({ items: z.array(deadlineSchema) })
  .meta({ id: 'DeadlineList' });

export const kpiTargetSchema = z
  .object({
    kpiGroup: z.string().min(1),
    maxBreaches: z.number().int().nonnegative(),
    achievementPct: z.number().nonnegative(),
  })
  .meta({ id: 'KpiTarget' });

export type KpiTarget = z.infer<typeof kpiTargetSchema>;

export const kpiTargetListSchema = z
  .object({ items: z.array(kpiTargetSchema) })
  .meta({ id: 'KpiTargetList' });

export const configDomainSchema = z.enum(['origin', 'dictionary', 'deadline', 'kpi_target']);
export type ConfigDomain = z.infer<typeof configDomainSchema>;

export const revisionSchema = z
  .object({
    id: z.uuid(),
    domain: configDomainSchema,
    summary: z.string(),
    author: z.string(),
    at: z.iso.datetime(),
  })
  .meta({ id: 'ConfigRevision' });

export const revisionListSchema = z
  .object({ items: z.array(revisionSchema) })
  .meta({ id: 'ConfigRevisionList' });

/** Creating an integration: the customer names the origin and what it sends. */
export const createIntegrationSchema = z
  .object({
    source: z
      .string()
      .min(1)
      .max(64)
      // Travels in the webhook path and as a Kafka key segment.
      .regex(/^[a-z][a-z0-9_]*$/, 'use lowercase letters, digits and underscore'),
    intake: intakeSchema,
    envelopeVersion: z.string().min(1).default('v1'),
  })
  .strict()
  .meta({ id: 'CreateIntegration' });

export const updateBindingsSchema = z
  .object({ bindings: z.array(fieldBindingSchema) })
  .strict()
  .meta({ id: 'UpdateBindings' });

export const upsertMappingSchema = z
  .object({
    field: mappingFieldSchema,
    from: z.string().min(1),
    to: z.string().min(1),
  })
  .strict()
  .meta({ id: 'UpsertMapping' });

export const updateDeadlinesSchema = z
  .object({ items: z.array(deadlineSchema) })
  .strict()
  .meta({ id: 'UpdateDeadlines' });

export const updateKpiTargetsSchema = z
  .object({ items: z.array(kpiTargetSchema) })
  .strict()
  .meta({ id: 'UpdateKpiTargets' });

/** The generated signing key, readable only in the response that mints it. */
export const secretSchema = z
  .object({
    secret: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'OriginSecret' });
