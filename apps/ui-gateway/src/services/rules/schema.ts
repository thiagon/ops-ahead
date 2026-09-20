import { z } from 'zod';

/**
 * Output contracts — mirror contracts/field-binding.schema.json,
 * contracts/translation-dictionary.schema.json, and the records data-ingest
 * reads off rules.deadline / rules.target
 * (apps/data-ingest/src/config_stream.py). The gateway publishes what the
 * consumers already expect; it never invents a shape of its own.
 *
 * Each record carries the whole state of its key: a consumer replaces what it
 * held for that key rather than merging, so an entry dropped here stops
 * existing downstream.
 */

const tenantId = z.string().min(1).meta({ description: 'Tenant the rule applies to' });

const severity = z.coerce
  .number()
  .int()
  .min(1)
  .max(5)
  .meta({ description: 'Normalized severity: 1=Critical … 5=VeryLow' });

/** Mapped values the domain constrains; resolution_code is free-form by design. */
const statusMapping = z.record(
  z.string(),
  z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed', 'canceled']),
);
const severityMapping = z.record(z.string(), z.enum(['1', '2', '3', '4', '5']));
const conditionMapping = z.record(z.string(), z.enum(['firing', 'cleared']));
const reportedByMapping = z.record(z.string(), z.enum(['automatic', 'manual']));
const resolutionCodeMapping = z.record(z.string(), z.string());

/**
 * How one origin's payload becomes the translated contract: where each field
 * is read, and what its values mean. The two halves travel as one record
 * because neither works alone — a dictionary entry translating "1 - Crítica"
 * to severity 1 says nothing without the binding naming the field it lives in.
 */
export const mappingSchema = z
  .object({
    intake: z.enum(['alert', 'monitor']),
    dictionary_version: z.string().min(1).meta({
      description: 'Stamped into every translated line this mapping produces',
    }),
    bindings: z
      .array(
        z
          .object({
            field: z.string().min(1),
            path: z
              .string()
              .regex(/^[^.]+(\.[^.]+)*$/)
              .nullable(),
          })
          .strict(),
      )
      .min(1),
    mappings: z
      .object({
        status: statusMapping.optional(),
        severity: severityMapping.optional(),
        condition: conditionMapping.optional(),
        reported_by: reportedByMapping.optional(),
        resolution_code: resolutionCodeMapping.optional(),
      })
      .strict(),
  })
  .strict()
  .meta({
    id: 'OriginMapping',
    description: "Field bindings and value dictionary for one origin's intake",
  });

export type Mapping = z.infer<typeof mappingSchema>;

export const deadlineSetSchema = z
  .object({
    deadlines: z
      .array(
        z
          .object({
            severity,
            deadline_seconds: z.coerce.number().int().positive(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .meta({
    id: 'DeadlineSet',
    description: "A tenant's contractual deadline per severity",
  });

export type DeadlineSet = z.infer<typeof deadlineSetSchema>;

export const targetSetSchema = z
  .object({
    targets: z
      .array(
        z
          .object({
            // Which severities this band scores together — a tenant can ask
            // for [1,2] combined or [3] alone instead of the Locaweb-shaped
            // p1_p2/p3 labels the dataset used to hardcode.
            severities: z.array(severity).min(1),
            max_breaches: z.coerce.number().int().nonnegative(),
            achievement_pct: z.coerce.number().min(0).max(100),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .meta({
    id: 'TargetSet',
    description: "A tenant's annual achievement bands",
  });

export type TargetSet = z.infer<typeof targetSetSchema>;

export const tenantParamsSchema = z.object({ tenant: tenantId });

export const originParamsSchema = z.object({
  tenant: tenantId,
  source: z.string().min(1).meta({ description: 'The origin system, e.g. service_now' }),
});

export const rulesAcceptedSchema = z
  .object({
    key: z.string().meta({ description: 'Compaction key this record was published under' }),
    topic: z.string(),
  })
  .meta({
    id: 'RulesAccepted',
    description: 'The bus owns the record now — consumers converge on their own',
  });

export const rulesErrorSchema = z
  .object({
    error: z.string().meta({ description: 'Machine-readable error name' }),
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: 'Which fields broke the contract' }),
  })
  .meta({ id: 'RulesErrorResponse' });
