import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import createError from 'http-errors';
import {
  addressParamsSchema,
  versionParam,
  webhookAcceptedSchema,
  webhookBatchAcceptedSchema,
  webhookBatchBodySchema,
  webhookBodySchema,
  webhookErrorSchema,
  webhookHeadersSchema,
  webhookParamsSchema,
} from '#services/events/schema.ts';

type WebhookRequest = FastifyRequest<{ Params: { tenant: string; source: string } }>;

/**
 * One route for every origin: which (tenant, source) pairs are accepted comes
 * from configuration, not from code, so the route matches on the path and the
 * sources table decides whether that source exists (services/sources/).
 *
 * The source the registry returns — never the URL or the payload — is what
 * assigns tenant_id, source and intake to the envelope
 * (domain/ubiquitous-language.md#tenant). `version` is the exception: it
 * selects which mapping version data-ingest translates by, so the caller
 * pins it per request and `latest` follows whatever the origin is configured
 * with today.
 */
export function registerEventRoutes(app: FastifyInstance): void {
  const events = app.services.events;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  const resolve = async (request: FastifyRequest) => {
    const { tenant, source } = (request as WebhookRequest).params;
    const found = await app.services.sources.find(tenant, source);
    // A source that exists but is turned off is told so, rather than being
    // made to look like an address nobody ever configured.
    if (found?.status === 'disabled') {
      throw createError.Forbidden('this source is disabled');
    }
    return found;
  };

  const BATCH_BODY_LIMIT = 5 * 1024 * 1024;

  for (const [path, params] of [
    ['/webhook/:tenant/:source/batch', addressParamsSchema],
    ['/webhook/:tenant/:source/:version/batch', webhookParamsSchema],
  ] as const) {
    typed.post(
      path,
      {
        bodyLimit: BATCH_BODY_LIMIT,
        preParsing: app.verifySignatureFor(resolve),
        ...app.auth.hmac({
          tags: ['events'],
          summary: 'Ingest a batch of events from a configured origin',
          description:
            'The body is an array of opaque events. Each one is enveloped and they share one Produce request. See domain/acl/itsm.md.',
          params,
          headers: webhookHeadersSchema,
          body: webhookBatchBodySchema,
          response: {
            202: webhookBatchAcceptedSchema,
            400: webhookErrorSchema,
            401: webhookErrorSchema,
            403: webhookErrorSchema,
            404: webhookErrorSchema,
            502: webhookErrorSchema,
          },
        }),
      },
      async (request, reply) => {
        const origin = await resolve(request);
        if (!origin) {
          return reply.status(404).send({
            error: 'UnknownOrigin',
            message: 'no integration is configured for this address',
          });
        }

        const pinned = (request.params as { version?: string }).version;
        const bodies = request.body as Record<string, unknown>[];
        const labels = { source: origin.source, intake: origin.intake };
        try {
          const result = await events.ingestBatch(
            { ...origin, version: versionParam.parse(pinned) },
            bodies,
          );
          request.server.metrics.eventsPublished.inc(labels, bodies.length);
          return reply.status(202).send(result);
        } catch (err) {
          request.server.metrics.publishFailures.inc(labels, bodies.length);
          throw err;
        }
      },
    );
  }

  for (const [path, params] of [
    ['/webhook/:tenant/:source', addressParamsSchema],
    ['/webhook/:tenant/:source/:version', webhookParamsSchema],
  ] as const) {
    typed.post(
      path,
      {
        // The origin signs what it posts with its own secret; this is the
        // signed surface for that (tenant, source) pair.
        preParsing: app.verifySignatureFor(resolve),
        ...app.auth.hmac({
          tags: ['events'],
          summary: 'Ingest an event from a configured origin',
          description:
            'The body is opaque: preserved verbatim in the raw envelope, never parsed or typed here. See domain/acl/itsm.md.',
          params,
          headers: webhookHeadersSchema,
          body: webhookBodySchema,
          response: {
            202: webhookAcceptedSchema,
            400: webhookErrorSchema,
            401: webhookErrorSchema,
            403: webhookErrorSchema,
            404: webhookErrorSchema,
            502: webhookErrorSchema,
          },
        }),
      },
      async (request, reply) => {
        const origin = await resolve(request);
        if (!origin) {
          return reply.status(404).send({
            error: 'UnknownOrigin',
            message: 'no integration is configured for this address',
          });
        }

        // Absent on the shorter route, where the schema's default fills in.
        const pinned = (request.params as { version?: string }).version;
        const labels = { source: origin.source, intake: origin.intake };
        try {
          const result = await events.ingest(
            { ...origin, version: versionParam.parse(pinned) },
            request.body,
          );
          request.server.metrics.eventsPublished.inc(labels);
          // 202, not 201: the bus owns the event now, the gateway holds nothing.
          return reply.status(202).send(result);
        } catch (err) {
          request.server.metrics.publishFailures.inc(labels);
          throw err;
        }
      },
    );
  }
}
