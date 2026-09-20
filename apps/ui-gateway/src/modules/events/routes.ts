import type { FastifyInstance } from 'fastify';
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

const INTAKES = ['alert', 'monitor'] as const;

/** Stamped when the caller does not pin one: the envelope format in use. */
const DEFAULT_VERSION = 'latest';

const webhookParamsSchema = z.object({
  tenant: z.string().min(1),
  source: z.string().min(1),
  version: z.string().min(1).optional(),
});

/**
 * One route per intake, since the nature of what arrives decides which raw
 * topic carries it (domain/ubiquitous-language.md#intake) and nothing else
 * downstream can recover it from an opaque body.
 *
 * The gateway does not decide whether an origin is known: it envelopes what
 * it receives and publishes. Whether the pipeline can translate that event is
 * data-ingest's question, answered against the mapping rules — an event with
 * no mapping stays raw in the lake instead of being refused here.
 */
export function registerIncidentRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  for (const intake of INTAKES) {
    for (const path of [
      `/webhook/${intake}/:tenant/:source`,
      `/webhook/${intake}/:tenant/:source/:version`,
    ]) {
      typed.post(
        path,
        {
          preParsing: app.verifySignature,
          schema: {
            tags: ['incidents'],
            summary: `Ingest a ${intake} event`,
            description:
              'The body is opaque: preserved verbatim in the raw envelope, never parsed or typed here. See domain/acl/itsm.md.',
            params: webhookParamsSchema,
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
          const { tenant, source, version } = request.params;
          const envelope = buildEnvelope(
            { tenantId: tenant, source, intake, version: version ?? DEFAULT_VERSION },
            request.body,
          );
          const topic = rawTopicFor(request.server.env, intake);

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
}
