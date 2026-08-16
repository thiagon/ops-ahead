import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { triggerAcceptedSchema, triggerErrorSchema, triggerRequestSchema } from './schema.ts';
import { triggerAnalysis } from './service.ts';

export function registerTriggerRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/trigger',
    {
      schema: {
        tags: ['trigger'],
        summary: 'Trigger a business analysis run',
        description:
          'Business-language entry point — no kubeconfig, Argo, or Kafka knowledge required by the caller. Responds immediately with a run_id; poll GET /runs/{run_id} for status.',
        body: triggerRequestSchema,
        response: {
          202: triggerAcceptedSchema,
          400: triggerErrorSchema,
          502: triggerErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await triggerAnalysis(request.server, request.body);
        return reply.status(202).send(result);
      } catch (err) {
        request.log.error({ err }, 'failed to publish trigger event');
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }
    },
  );
}
