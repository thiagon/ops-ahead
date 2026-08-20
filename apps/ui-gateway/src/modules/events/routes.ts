import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { rawTopicFor } from '../../env.ts';
import {
  webhookAcceptedSchema,
  webhookBodySchema,
  webhookErrorSchema,
  webhookHeadersSchema,
} from './schema.ts';
import { buildEnvelope } from './service.ts';
import { ORIGIN_CREDENTIALS, routePath } from './sources/registry.ts';

/**
 * One route per registered credential (domain/ubiquitous-language.md#tenant,
 * #source). Each is independently signed — a route never sees another
 * tenant's secret — and each publishes to the raw topic for its own intake.
 */
export function registerIncidentRoutes(app: FastifyInstance): void {
  for (const credential of ORIGIN_CREDENTIALS) {
    app.withTypeProvider<ZodTypeProvider>().post(
      routePath(credential),
      {
        // The origin signs what it posts with this credential's own secret;
        // this is the signed surface for this (tenant, source) pair.
        preParsing: app.verifySignatureFor(credential),
        schema: {
          tags: ['incidents'],
          summary: `Ingest an event from ${credential.source} (tenant: ${credential.tenantId})`,
          description:
            'The body is opaque: preserved verbatim in the raw envelope, never parsed or typed here. See domain/acl/itsm.md.',
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
}
