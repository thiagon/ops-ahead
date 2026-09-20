import { z } from 'zod';

export const tenantParamsSchema = z.object({ tenant: z.string().min(1) });

export const sourceParamsSchema = z.object({
  tenant: z.string().min(1),
  source: z.string().min(1).meta({ description: 'The origin system, e.g. service_now' }),
});

/** A secret the caller brings; omitted, the gateway mints one. */
const providedSecret = z.string().min(16).optional().meta({
  description: 'Leave it out to have one generated',
});

export const sourceRegistrationSchema = z
  .object({
    intake: z.enum(['alert', 'monitor']).meta({
      description: 'Which raw topic this source’s events are carried on',
    }),
    secret: providedSecret,
  })
  .strict()
  .meta({ id: 'SourceRegistration' });

export const secretRotationSchema = z
  .object({ secret: providedSecret })
  .strict()
  .meta({ id: 'SecretRotation' });

export const sourceSummarySchema = z
  .object({
    tenant_id: z.string(),
    source: z.string(),
    intake: z.enum(['alert', 'monitor']),
  })
  .meta({ id: 'Source', description: 'A registered source — never its secret' });

export const sourceWithSecretSchema = z
  .object({
    source: sourceSummarySchema,
    secret: z.string().meta({
      description: 'Returned this once and never again — store it before discarding it',
    }),
  })
  .meta({ id: 'SourceWithSecret' });

export const sourceErrorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'SourceErrorResponse' });
