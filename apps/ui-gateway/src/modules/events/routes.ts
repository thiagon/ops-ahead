import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { rawTopicFor } from '../../env.ts';
import {
  webhookAcceptedSchema,
  webhookBodySchema,
  webhookErrorSchema,
  webhookHeadersSchema,
} from './schema.ts';
import { buildEnvelope } from './service.ts';

const webhookParamsSchema = z.object({
  version: z.string().min(1),
  tenant: z.string().min(1),
  source: z.string().min(1),
});

type WebhookRequest = FastifyRequest<{ Params: z.infer<typeof webhookParamsSchema> }>;

/**
 * One route for every origin: which (tenant, source) pairs are accepted comes
 * from configuration, not from code, so the route matches on the path and the
 * registry decides whether that origin exists (plugins/origin-registry.ts).
 *
 * The credential the registry returns — never the URL or the payload — is what
 * assigns tenant_id, source and intake to the envelope
 * (domain/ubiquitous-language.md#tenant).
 */
export function registerIncidentRoutes(app: FastifyInstance): void {
  const resolve = (request: FastifyRequest) => {
    const { tenant, source, version } = (request as WebhookRequest).params;
    const credential = app.origins.find(tenant, source);
    // A credential registered under another envelope version does not answer
    // this address.
    return credential?.envelopeVersion === version ? credential : undefined;
  };

  app.withTypeProvider<ZodTypeProvider>().post(
    '/webhook/:version/:tenant/:source',
    {
      // The origin signs what it posts with its own secret; this is the signed
      // surface for that (tenant, source) pair.
      preParsing: app.verifySignatureFor(resolve),
      schema: {
        tags: ['incidents'],
        summary: 'Ingest an event from a configured origin',
        description:
          'The body is opaque: preserved verbatim in the raw envelope, never parsed or typed here. See domain/acl/itsm.md.',
        params: webhookParamsSchema,
        headers: webhookHeadersSchema,
        body: webhookBodySchema,
        response: {
          202: webhookAcceptedSchema,
          400: webhookErrorSchema,
          401: webhookErrorSchema,
          404: webhookErrorSchema,
          502: webhookErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const credential = resolve(request);
      if (!credential) {
        return reply.status(404).send({
          error: 'UnknownOrigin',
          message: 'no integration is configured for this address',
        });
      }

      const envelope = buildEnvelope(credential, request.body);
      const topic = rawTopicFor(request.server.env, credential.intake);

      try {
        await request.server.kafka.publish({
          topic,
          key: envelope.event_id,
          value: JSON.stringify(envelope),
        });
      } catch (err) {
        request.server.metrics.publishFailures.inc({
          source: envelope.source,
          intake: envelope.intake,
        });
        request.log.error(
          { err, event_id: envelope.event_id },
          'failed to publish incident envelope',
        );
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }

      request.server.metrics.eventsPublished.inc({
        source: envelope.source,
        intake: envelope.intake,
      });
      // 202, not 201: the bus owns the event now, the gateway holds nothing.
      return reply.status(202).send({
        event_id: envelope.event_id,
        tenant_id: envelope.tenant_id,
        source: envelope.source,
      });
    },
  );
}
