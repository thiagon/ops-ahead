import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  analysisAcceptedSchema,
  analysisErrorSchema,
  analysisParamsSchema,
  analysisRequestSchema,
  analysisStatusSchema,
  analysisStatusUpdateSchema,
  analysisUpdateHeadersSchema,
} from '../../services/analyses/schema.ts';

export function registerAnalysisRoutes(app: FastifyInstance): void {
  const analyses = app.services.analyses;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post(
    '/analyses',
    {
      schema: {
        tags: ['analyses'],
        summary: 'Start a business analysis',
        description:
          'Business-language entry point — no kubeconfig, Argo, or Kafka knowledge required by the caller. Responds immediately with an id; poll GET /analyses/{id} for status.',
        body: analysisRequestSchema,
        response: {
          202: analysisAcceptedSchema,
          400: analysisErrorSchema,
          502: analysisErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await analyses.start(request.body);
        return reply.status(202).send(result);
      } catch (err) {
        request.log.error({ err }, 'failed to publish analysis event');
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }
    },
  );

  typed.get(
    '/analyses/:id',
    {
      schema: {
        tags: ['analyses'],
        summary: 'Look up an analysis status',
        description:
          'Reflects the row in the gateway database — never queries Kubernetes. Trainers PATCH this same path when the run changes state.',
        params: analysisParamsSchema,
        response: {
          200: analysisStatusSchema,
          404: analysisErrorSchema,
        },
      },
    },
    async request => analyses.getStatus(request.params.id),
  );

  typed.patch(
    '/analyses/:id',
    {
      schema: {
        tags: ['analyses'],
        summary: 'Update an analysis status',
        description:
          'Called by the Kafka consumer that received this run. Requires `X-Update-Key` from that message — the HTTP 202 never includes it.',
        params: analysisParamsSchema,
        headers: analysisUpdateHeadersSchema,
        body: analysisStatusUpdateSchema,
        response: {
          200: analysisStatusSchema,
          400: analysisErrorSchema,
          401: analysisErrorSchema,
        },
      },
    },
    async request =>
      analyses.update(request.params.id, request.body, request.headers['x-update-key']),
  );
}
