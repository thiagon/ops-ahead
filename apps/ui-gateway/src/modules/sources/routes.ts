import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  secretRotationSchema,
  sourceErrorSchema,
  sourceParamsSchema,
  sourceRegistrationSchema,
  sourceSummarySchema,
  sourceWithSecretSchema,
  tenantParamsSchema,
} from '../../services/sources/schema.ts';

/**
 * Every route hangs off a tenant: a source only means anything inside one,
 * and there is no listing that spans them
 * (domain/ubiquitous-language.md#tenant).
 */
export function registerSourceRoutes(app: FastifyInstance): void {
  const sources = app.services.sources;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/tenants/:tenant/sources',
    {
      schema: {
        tags: ['sources'],
        summary: "List a tenant's registered sources",
        description: 'Secrets are never included — a lost one is replaced by rotating it.',
        params: tenantParamsSchema,
        response: { 200: z.array(sourceSummarySchema) },
      },
    },
    async request => sources.listByTenant(request.params.tenant),
  );

  typed.put(
    '/tenants/:tenant/sources/:source',
    {
      schema: {
        tags: ['sources'],
        summary: 'Register a source',
        description:
          'Answers with the secret this source signs with, this once and never again. Idempotent on the pair — a second PUT replaces the secret.',
        params: sourceParamsSchema,
        body: sourceRegistrationSchema,
        response: { 200: sourceWithSecretSchema, 400: sourceErrorSchema },
      },
    },
    async request => {
      const { tenant, source } = request.params;
      const { intake, secret } = request.body;
      return sources.register(tenant, source, intake, secret);
    },
  );

  typed.post(
    '/tenants/:tenant/sources/:source/secret',
    {
      schema: {
        tags: ['sources'],
        summary: "Rotate a source's secret",
        description:
          'The previous secret stops being accepted, so the source has to start signing with the new one right away. Answers with it this once and never again.',
        params: sourceParamsSchema,
        body: secretRotationSchema,
        response: {
          200: sourceWithSecretSchema,
          400: sourceErrorSchema,
          404: sourceErrorSchema,
        },
      },
    },
    async request => {
      const { tenant, source } = request.params;
      return sources.rotate(tenant, source, request.body.secret);
    },
  );
}
