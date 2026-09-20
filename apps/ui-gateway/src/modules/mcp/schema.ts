import { z } from 'zod';
import { analysisParamsSchema, analysisRequestSchema } from '../../services/analyses/schema.ts';
import {
  alertMappingSchema,
  deadlineSetSchema,
  monitorMappingSchema,
  originParamsSchema,
  targetSetSchema,
} from '../../services/rules/schema.ts';
import {
  secretRotationSchema,
  sourceParamsSchema,
  sourceRegistrationSchema,
  statusChangeSchema,
} from '../../services/sources/schema.ts';

export { analysisParamsSchema, analysisRequestSchema, deadlineSetSchema, targetSetSchema };

const source = originParamsSchema.shape.source;

/** Path `source` folded into the body — tenant stays on `/mcp/:tenant`. */
export const registerSourceInputSchema = sourceRegistrationSchema.extend({ source });

export const setSourceStatusInputSchema = statusChangeSchema.extend({ source });

export const rotateSourceSecretInputSchema = secretRotationSchema.extend({ source });

export const setMappingInputSchema = z.discriminatedUnion('intake', [
  alertMappingSchema.extend({ source }),
  monitorMappingSchema.extend({ source }),
]);

export const getMappingInputSchema = originParamsSchema.pick({ source: true });

export const tenantParamsSchema = sourceParamsSchema.pick({ tenant: true });
