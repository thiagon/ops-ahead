import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  deadlineSetSchema,
  mappingSchema,
  originParamsSchema,
  rulesAcceptedSchema,
  rulesErrorSchema,
  targetSetSchema,
  tenantParamsSchema,
} from '../../services/rules/schema.ts';

export function registerRulesRoutes(app: FastifyInstance): void {
  const rules = app.services.rules;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.put(
    '/rules/mappings/:tenant/:source',
    {
      schema: {
        tags: ['rules'],
        summary: "Publish one origin's field bindings and value dictionary",
        description:
          'Bindings and dictionary are one record: a translated value means nothing without the field it was read from. Idempotent — a later PUT under the same key replaces this one.',
        params: originParamsSchema,
        body: mappingSchema,
        response: {
          202: rulesAcceptedSchema,
          400: rulesErrorSchema,
          502: rulesErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { tenant, source } = request.params;
      try {
        const result = await rules.setMapping(tenant, source, request.body);
        return reply.status(202).send(result);
      } catch (err) {
        request.log.error({ err }, 'failed to publish mapping rule');
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }
    },
  );

  typed.put(
    '/rules/deadlines/:tenant',
    {
      schema: {
        tags: ['rules'],
        summary: "Publish a tenant's contractual deadlines",
        params: tenantParamsSchema,
        body: deadlineSetSchema,
        response: {
          202: rulesAcceptedSchema,
          400: rulesErrorSchema,
          502: rulesErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await rules.setDeadlines(request.params.tenant, request.body);
        return reply.status(202).send(result);
      } catch (err) {
        request.log.error({ err }, 'failed to publish deadline rule');
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }
    },
  );

  typed.put(
    '/rules/targets/:tenant',
    {
      schema: {
        tags: ['rules'],
        summary: "Publish a tenant's KPI achievement targets",
        params: tenantParamsSchema,
        body: targetSetSchema,
        response: {
          202: rulesAcceptedSchema,
          400: rulesErrorSchema,
          502: rulesErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await rules.setTargets(request.params.tenant, request.body);
        return reply.status(202).send(result);
      } catch (err) {
        request.log.error({ err }, 'failed to publish KPI target rule');
        return reply.status(502).send({
          error: 'PublishFailed',
          message: 'could not publish the event to the bus',
        });
      }
    },
  );
}
