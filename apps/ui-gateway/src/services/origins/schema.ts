import { z } from 'zod';

export const originParamsSchema = z.object({
  tenant: z.string().min(1),
  source: z.string().min(1).meta({ description: 'The origin system, e.g. service_now' }),
});

/** A secret the caller brings; omitted, the gateway mints one. */
const providedSecret = z.string().min(16).optional().meta({
  description: 'Leave it out to have one generated',
});

export const originRegistrationSchema = z
  .object({
    intake: z.enum(['alert', 'monitor']).meta({
      description: 'Which raw topic this origin’s events are carried on',
    }),
    secret: providedSecret,
  })
  .strict()
  .meta({ id: 'OriginRegistration' });

export const secretRotationSchema = z
  .object({ secret: providedSecret })
  .strict()
  .meta({ id: 'SecretRotation' });

export const originSummarySchema = z
  .object({
    tenant_id: z.string(),
    source: z.string(),
    intake: z.enum(['alert', 'monitor']),
  })
  .meta({ id: 'Origin', description: 'A registered origin — never its secret' });

export const originWithSecretSchema = z
  .object({
    origin: originSummarySchema,
    secret: z.string().meta({
      description: 'Returned this once and never again — store it before discarding it',
    }),
  })
  .meta({ id: 'OriginWithSecret' });

export const originErrorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'OriginErrorResponse' });
