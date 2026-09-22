import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { UserAuth } from '#lib/auth.ts';
import {
  analysisAcceptedSchema,
  analysisErrorSchema,
  analysisListQuerySchema,
  analysisParamsSchema,
  analysisRequestSchema,
  analysisStatusSchema,
  analysisStatusUpdateSchema,
  analysisUpdateHeadersSchema,
  tenantParamsSchema,
} from '#services/analyses/schema.ts';

export function registerAnalysisRoutes(app: FastifyInstance): void {
  const analyses = app.services.analyses;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/:tenant/analyses',
    app.auth(['user', 'tenant', 'writer'], { relation: 'and' })({
      tags: ['analyses'],
      summary: 'Start a business analysis for a tenant',
      description:
        'Business-language entry point — no kubeconfig, Argo, or Kafka knowledge required by the caller. Responds immediately with an id; poll GET /{tenant}/analyses/{id} for status.',
      params: tenantParamsSchema,
      body: analysisRequestSchema,
      response: {
        202: analysisAcceptedSchema,
        400: analysisErrorSchema,
        401: analysisErrorSchema,
        403: analysisErrorSchema,
        502: analysisErrorSchema,
      },
    }),
    async (request, reply) =>
      reply.status(202).send(await analyses.start(request.body, request.auth.origin())),
  );

  typed.post(
    '/analyses',
    app.auth(['scheduler', 'run'])({
      tags: ['analyses'],
      summary: 'Start a scheduled or chained analysis',
      description:
        'Authenticated by the scheduler API key or by the parent run key — never by a session. A person starts an analysis through POST /{tenant}/analyses.',
      body: analysisRequestSchema,
      response: {
        202: analysisAcceptedSchema,
        400: analysisErrorSchema,
        401: analysisErrorSchema,
        409: analysisErrorSchema,
        502: analysisErrorSchema,
      },
    }),
    async (request, reply) =>
      reply.status(202).send(await analyses.start(request.body, request.auth.origin())),
  );

  typed.get(
    '/:tenant/analyses',
    app.auth.tenant({
      tags: ['analyses'],
      summary: "List a tenant's analyses, most recent first",
      params: tenantParamsSchema,
      querystring: analysisListQuerySchema.omit({ tenant_id: true }),
      response: { 200: analysisStatusSchema.array(), 401: analysisErrorSchema },
    }),
    async request =>
      analyses.list({
        trigger: request.query.trigger,
        analysis: request.query.analysis,
        tenantId: request.params.tenant,
        limit: request.query.limit,
      }),
  );

  typed.get(
    '/analyses/:id',
    app.auth.user({
      tags: ['analyses'],
      summary: 'Look up an analysis status',
      description:
        'Reflects the row in the gateway database — never queries Kubernetes. Consumers PATCH this same path when the run changes state.',
      params: analysisParamsSchema,
      response: {
        200: analysisStatusSchema,
        401: analysisErrorSchema,
        403: analysisErrorSchema,
        404: analysisErrorSchema,
      },
    }),
    async request =>
      analyses.getStatus(
        request.params.id,
        request.auth instanceof UserAuth ? request.auth.tenants : undefined,
      ),
  );

  typed.patch(
    '/analyses/:id',
    app.auth.run({
      tags: ['analyses'],
      summary: 'Update an analysis status',
      description:
        'Called by the Kafka consumer that received this run. Requires `X-Run-Key` from that message — the HTTP 202 never includes it.',
      params: analysisParamsSchema,
      headers: analysisUpdateHeadersSchema,
      body: analysisStatusUpdateSchema,
      response: {
        200: analysisStatusSchema,
        400: analysisErrorSchema,
        401: analysisErrorSchema,
        409: analysisErrorSchema,
      },
    }),
    async request => analyses.update(request.params.id, request.body, request.headers['x-run-key']),
  );
}
