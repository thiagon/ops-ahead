import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { webhookAcceptedSchema, webhookBodySchema, webhookErrorSchema } from './schema.ts';
import { resolveAdapter } from './service.ts';

export function registerIncidentRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/webhook/incidents',
    {
      // The origin systems sign what they post; this is the signed surface.
      preParsing: app.verifySignature,
      schema: {
        tags: ['incidents'],
        summary: 'Ingest an incident event from an origin system',
        body: webhookBodySchema,
        response: {
          202: webhookAcceptedSchema,
          400: webhookErrorSchema,
          401: webhookErrorSchema,
          422: webhookErrorSchema,
          502: webhookErrorSchema,
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

      const { event } = normalized;
      try {
        await request.server.kafka.publish({
          key: event.event_id,
          value: JSON.stringify(event),
        });
      } catch (err) {
        request.server.metrics.publishFailures.inc({ source: adapter.source });
        request.log.error({ err, event_id: event.event_id }, 'failed to publish incident event');
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }

      request.server.metrics.eventsPublished.inc({ source: adapter.source });
      // 202, not 201: the bus owns the event now, the gateway holds nothing.
      return reply.status(202).send({ event_id: event.event_id, source: event.source });
    },
  );
}
