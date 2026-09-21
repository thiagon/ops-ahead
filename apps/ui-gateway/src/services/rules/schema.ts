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
 * Where a bronze column is read in the origin payload. Origins almost never
 * use the translated names, so each bound column points at a path of its own.
 * Omit a column the origin does not send — only the contract's required
 * fields must be present.
 */
const originPath = z
  .string()
  .regex(/^[^.]+(\.[^.]+)*$/)
  .meta({
    description:
      "Dotted path into the origin's payload, e.g. 'fields.status.name'. The origin almost never names fields the way bronze does.",
  });

function optionalPath(description: string) {
  return originPath.optional().meta({ description });
}

/**
 * Bronze `labels` is a map. An origin either already sends one (a single
 * path) or scatters the entries across fields — product, category, … — that
 * get joined here.
 */
const labelEntry = z
  .object({
    key: z.string().min(1).meta({
      description: 'Name written into the bronze labels map, e.g. product or category',
    }),
    path: originPath,
  })
  .strict();

const labelsBinding = z
  .union([
    originPath,
    z.array(labelEntry).min(1).meta({
      description: 'Origin fields joined into the bronze labels map',
    }),
  ])
  .optional()
  .meta({
    description:
      'Path to a map the origin already sends, or several origin fields joined into labels (product, category, …).',
  });

/** Pipeline-stamped: event_id, tenant_id, source, version, dictionary_version, received_at. */
const alertBindings = z
  .object({
    external_id: originPath.meta({ description: 'Identity in the origin, e.g. a ticket number' }),
    opened_at: originPath.meta({ description: 'When the incident was opened' }),
    acknowledged_at: optionalPath('When someone took ownership'),
    resolved_at: optionalPath('When the cause was resolved'),
    closed_at: optionalPath('When the incident was closed'),
    severity: originPath.meta({
      description: "Origin's own severity/priority label, translated to 1–5",
    }),
    status: originPath.meta({ description: 'Lifecycle state, translated by the dictionary' }),
    entity_id: optionalPath('What was affected'),
    title: originPath.meta({ description: 'One-line summary' }),
    description: optionalPath('Full description'),
    owner: optionalPath('Who currently holds the incident'),
    reported_by: optionalPath('How it was opened — translated to automatic/manual'),
    parent_id: optionalPath('Parent incident, when the origin has one'),
    resolution_code: optionalPath('How the incident ended, translated by the dictionary'),
    resolution_summary: optionalPath('What was done to close it'),
    labels: labelsBinding,
    source_url: optionalPath('Link back to the incident in the origin'),
  })
  .strict();

const monitorBindings = z
  .object({
    external_id: originPath.meta({ description: 'Identity in the origin' }),
    started_at: originPath.meta({ description: 'When the condition started firing' }),
    ended_at: optionalPath('When it cleared — omit while the origin has no end'),
    severity: optionalPath("Origin's own severity label, translated to 1–5"),
    condition: originPath.meta({ description: 'firing/cleared, translated by the dictionary' }),
    entity_id: originPath.meta({ description: 'The only correlation key with the alert chain' }),
    title: optionalPath('One-line summary'),
    description: optionalPath('Full description'),
    labels: labelsBinding,
    source_url: optionalPath('Link back to the signal in the origin'),
  })
  .strict();

const mappingVersion = z.string().min(1).meta({
  description: 'Stamped as dictionary_version into every translated line this mapping produces',
});

const alertMappings = z
  .object({
    status: statusMapping.optional().meta({
      description: 'Lifecycle of the incident. An unmapped value becomes unknown.',
    }),
    severity: severityMapping.optional().meta({
      description: "The origin's scale translated to ours.",
    }),
    reported_by: reportedByMapping.optional().meta({
      description: 'How the incident was opened.',
    }),
    resolution_code: resolutionCodeMapping.optional().meta({
      description: 'Why it closed. An unmapped value passes through untranslated.',
    }),
  })
  .strict();

const monitorMappings = z
  .object({
    condition: conditionMapping.optional().meta({
      description: 'Whether the condition is firing or cleared.',
    }),
    severity: severityMapping.optional().meta({
      description: "The origin's scale translated to ours.",
    }),
  })
  .strict();

/**
 * How one origin's payload becomes the translated contract: where each bronze
 * column is read, and what its values mean. The two halves travel as one
 * record because neither works alone — a dictionary entry translating
 * "1 - Crítica" to severity 1 says nothing without the binding naming the
 * field it lives in.
 *
 * Bindings are the bronze columns data-ingest writes to ClickHouse, not the
 * origin's own keys. Required columns need a path; the rest are omitted when
 * the origin does not send them.
 */
export const alertMappingSchema = z
  .object({
    intake: z.literal('alert'),
    version: mappingVersion,
    bindings: alertBindings,
    mappings: alertMappings,
  })
  .strict();

export const monitorMappingSchema = z
  .object({
    intake: z.literal('monitor'),
    version: mappingVersion,
    bindings: monitorBindings,
    mappings: monitorMappings,
  })
  .strict();

export const mappingSchema = z
  .discriminatedUnion('intake', [alertMappingSchema, monitorMappingSchema])
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
            seconds: z.coerce.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .check(ctx => {
        const seen = new Set<number>();
        for (const [index, deadline] of ctx.value.entries()) {
          if (seen.has(deadline.severity)) {
            ctx.issues.push({
              code: 'custom',
              message: 'each severity can appear only once',
              path: [index, 'severity'],
              input: deadline.severity,
              continue: true,
            });
          }
          seen.add(deadline.severity);
        }
      }),
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

const historyMeta = {
  id: z.number().int().positive(),
  created_at: z.iso.datetime(),
};

export const mappingHistorySchema = z
  .discriminatedUnion('intake', [
    alertMappingSchema.extend(historyMeta),
    monitorMappingSchema.extend(historyMeta),
  ])
  .meta({ id: 'MappingHistory' });
export const deadlineHistorySchema = deadlineSetSchema
  .extend(historyMeta)
  .meta({ id: 'DeadlineHistory' });
export const targetHistorySchema = targetSetSchema
  .extend(historyMeta)
  .meta({ id: 'TargetHistory' });

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

/**
 * The same Zod documents REST and MCP already validate, as JSON Schema.
 * The UI reads this instead of keeping a second copy of the contract.
 */
export function rulesJsonSchema() {
  return {
    mapping: z.toJSONSchema(mappingSchema),
    deadlines: z.toJSONSchema(deadlineSetSchema),
    targets: z.toJSONSchema(targetSetSchema),
  };
}

export const rulesJsonSchemaResponse = z
  .object({
    mapping: z.unknown(),
    deadlines: z.unknown(),
    targets: z.unknown(),
  })
  .meta({
    id: 'RulesJsonSchema',
    description: 'JSON Schema for origin mappings, deadline sets and KPI target sets',
  });
