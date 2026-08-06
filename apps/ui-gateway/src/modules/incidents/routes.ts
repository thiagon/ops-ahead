import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { webhookAcceptedSchema, webhookErrorSchema, webhookHeadersSchema } from './schema.ts';
import { normalizeWebhook, webhookBodySchema } from './service.ts';

export function registerIncidentRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/webhook/incidents',
    {
      // The origin systems sign what they post; this is the signed surface.
      preParsing: app.verifySignature,
      schema: {
        tags: ['incidents'],
        summary: 'Ingest an incident event from an origin system',
        description:
          'The body is discriminated on `source`: each registered origin has its own contract. An unknown source, or a payload that breaks its contract, is a 400.',
        headers: webhookHeadersSchema,
        body: webhookBodySchema,
        response: {
          202: webhookAcceptedSchema,
          400: webhookErrorSchema,
          401: webhookErrorSchema,
          502: webhookErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const event = normalizeWebhook(request.body);

      try {
        await request.server.kafka.publish({
          key: event.event_id,
          value: JSON.stringify(event),
        });
      } catch (err) {
        request.server.metrics.publishFailures.inc({ source: event.source });
        request.log.error({ err, event_id: event.event_id }, 'failed to publish incident event');
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }

      request.server.metrics.eventsPublished.inc({ source: event.source });
      // 202, not 201: the bus owns the event now, the gateway holds nothing.
      return reply.status(202).send({ event_id: event.event_id, source: event.source });
    },
  );
}
