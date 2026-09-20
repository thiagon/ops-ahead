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

/** Stamped when the caller pins none: translate against the current mapping. */
const DEFAULT_VERSION = 'latest';

const webhookParamsSchema = z.object({
  tenant: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1).optional(),
});

type WebhookRequest = FastifyRequest<{ Params: z.infer<typeof webhookParamsSchema> }>;

/**
 * One route for every origin: which (tenant, source) pairs are accepted comes
 * from configuration, not from code, so the route matches on the path and the
 * origins table decides whether that origin exists (services/origins/).
 *
 * The origin the registry returns — never the URL or the payload — is what
 * assigns tenant_id, source and intake to the envelope
 * (domain/ubiquitous-language.md#tenant). `version` is the exception: it
 * selects which mapping version data-ingest translates by, so the caller
 * pins it per request and `latest` follows whatever the origin is configured
 * with today.
 */
export function registerIncidentRoutes(app: FastifyInstance): void {
  const resolve = async (request: FastifyRequest) => {
    const { tenant, source } = (request as WebhookRequest).params;
    return app.services.origins.find(tenant, source);
  };

  const typed = app.withTypeProvider<ZodTypeProvider>();

  for (const path of ['/webhook/:tenant/:source', '/webhook/:tenant/:source/:version']) {
    typed.post(
      path,
      {
        // The origin signs what it posts with its own secret; this is the
        // signed surface for that (tenant, source) pair.
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
        const origin = await resolve(request);
        if (!origin) {
          return reply.status(404).send({
            error: 'UnknownOrigin',
            message: 'no integration is configured for this address',
          });
        }

        const envelope = buildEnvelope(
          { ...origin, version: request.params.version ?? DEFAULT_VERSION },
          request.body,
        );
        const topic = rawTopicFor(request.server.env, origin.intake);

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
}
