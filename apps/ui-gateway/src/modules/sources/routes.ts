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
  statusChangeSchema,
  tenantParamsSchema,
} from '../../services/sources/schema.ts';

/**
 * A source only means anything inside a tenant, so every route carries one
 * and there is no listing that spans them
 * (domain/ubiquitous-language.md#tenant). The `:tenant` selects the client;
 * whether the caller may act for it is the claim's to say (plugins/auth.ts).
 */
export function registerSourceRoutes(app: FastifyInstance): void {
  const sources = app.services.sources;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/sources/:tenant',
    app.auth.tenant({
      tags: ['sources'],
      summary: "List a tenant's registered sources",
      description: 'Secrets are never included — a lost one is replaced by rotating it.',
      params: tenantParamsSchema,
      response: { 200: z.array(sourceSummarySchema) },
    }),
    async request => sources.listByTenant(request.params.tenant),
  );

  typed.put(
    '/sources/:tenant/:source',
    app.auth.operator({
      tags: ['sources'],
      summary: 'Register a source',
      description:
        'Answers with the secret this source signs with, this once and never again. Idempotent on the pair — a second PUT replaces the secret and keeps the status.',
      params: sourceParamsSchema,
      body: sourceRegistrationSchema,
      response: { 200: sourceWithSecretSchema, 400: sourceErrorSchema },
    }),
    async request => {
      const { tenant, source } = request.params;
      const { intake, secret } = request.body;
      return sources.register(tenant, source, intake, secret);
    },
  );

  typed.put(
    '/sources/:tenant/:source/status',
    app.auth.operator({
      tags: ['sources'],
      summary: 'Turn a source off or back on',
      description:
        'A disabled source keeps its configuration and its secret; its webhooks answer 403 until it is enabled again.',
      params: sourceParamsSchema,
      body: statusChangeSchema,
      response: {
        200: sourceSummarySchema,
        400: sourceErrorSchema,
        404: sourceErrorSchema,
      },
    }),
    async request => {
      const { tenant, source } = request.params;
      return sources.setStatus(tenant, source, request.body.status);
    },
  );

  typed.post(
    '/sources/:tenant/:source/secret',
    app.auth.operator({
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
    }),
    async request => {
      const { tenant, source } = request.params;
      return sources.rotate(tenant, source, request.body.secret);
    },
  );
}
