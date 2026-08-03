import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { webhookAcceptedSchema, webhookBodySchema, webhookErrorSchema } from './schema.ts';
import { resolveAdapter } from './service.ts';

export function registerIncidentRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/webhook/incidents',
    {
      schema: {
        tags: ['incidents'],
        summary: 'Ingest an incident event from an origin system',
        body: webhookBodySchema,
        response: {
          202: webhookAcceptedSchema,
          400: webhookErrorSchema,
          422: webhookErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const adapter = resolveAdapter(request.body.source);
      if (!adapter) {
        return reply.status(400).send({
          error: 'UnknownSource',
          message: `no adapter registered for source "${request.body.source}"`,
        });
      }

      const normalized = adapter.normalize(request.body);
      if (!normalized.success) {
        return reply.status(422).send({
          error: 'ValidationError',
          message: `payload does not match the ${adapter.source} contract`,
          details: normalized.issues,
        });
      }

      // Publishing to Kafka is wired in Phase 3.
      return reply.status(202).send({
        event_id: normalized.event.event_id,
        source: normalized.event.source,
      });
    },
  );
}
