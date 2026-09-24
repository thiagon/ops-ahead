import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  deadlineHistorySchema,
  deadlineSetSchema,
  mappingHistorySchema,
  mappingSchema,
  originParamsSchema,
  rulesAcceptedSchema,
  rulesErrorSchema,
  rulesJsonSchema,
  rulesJsonSchemaResponse,
  targetHistorySchema,
  targetSetSchema,
  tenantParamsSchema,
} from '../../services/rules/schema.ts';

export function registerRulesRoutes(app: FastifyInstance): void {
  const rules = app.services.rules;
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/rules/schema',
    app.auth.user({
      tags: ['rules'],
      summary: 'JSON Schema for mapping, deadline and target documents',
      description:
        'The same contracts REST and MCP validate. The UI uses this so the field list, required flags and value dictionaries are not copied.',
      response: { 200: rulesJsonSchemaResponse },
    }),
    () => rulesJsonSchema(),
  );

  typed.put(
    '/rules/mappings/:tenant/:source',
    app.auth.operator({
      tags: ['rules'],
      summary: "Publish one origin's field bindings and value dictionary",
      description:
        'Bindings and dictionary are one record: a translated value means nothing without the field it was read from. Idempotent — a later PUT under the same key replaces this one.',
      params: originParamsSchema,
      body: mappingSchema,
      response: {
        202: rulesAcceptedSchema,
        400: rulesErrorSchema,
        404: rulesErrorSchema,
        502: rulesErrorSchema,
      },
    }),
    async (request, reply) => {
      const { tenant, source } = request.params;
      return reply.status(202).send(await rules.setMapping(tenant, source, request.body));
    },
  );

  typed.get(
    '/rules/mappings/:tenant/:source',
    app.auth.tenant({
      tags: ['rules'],
      summary: 'Read the current mapping for an origin',
      params: originParamsSchema,
      response: { 200: mappingSchema, 404: rulesErrorSchema },
    }),
    async request => {
      const { tenant, source } = request.params;
      return rules.getMapping(tenant, source);
    },
  );

  typed.get(
    '/rules/mappings/:tenant/:source/history',
    app.auth.tenant({
      tags: ['rules'],
      summary: 'List the last ten published mappings, newest first',
      params: originParamsSchema,
      response: { 200: z.array(mappingHistorySchema) },
    }),
    async request => {
      const { tenant, source } = request.params;
      return rules.listMappingHistory(tenant, source);
    },
  );

  typed.put(
    '/rules/deadlines/:tenant',
    app.auth.operator({
      tags: ['rules'],
      summary: "Publish a tenant's contractual deadlines",
      params: tenantParamsSchema,
      body: deadlineSetSchema,
      response: {
        202: rulesAcceptedSchema,
        400: rulesErrorSchema,
        502: rulesErrorSchema,
      },
    }),
    async (request, reply) =>
      reply.status(202).send(await rules.setDeadlines(request.params.tenant, request.body)),
  );

  typed.get(
    '/rules/deadlines/:tenant',
    app.auth.tenant({
      tags: ['rules'],
      summary: "Read this tenant's current deadlines",
      params: tenantParamsSchema,
      response: { 200: deadlineSetSchema, 404: rulesErrorSchema },
    }),
    async request => rules.getDeadlines(request.params.tenant),
  );

  typed.get(
    '/rules/deadlines/:tenant/history',
    app.auth.tenant({
      tags: ['rules'],
      summary: 'List the last ten published deadlines, newest first',
      params: tenantParamsSchema,
      response: { 200: z.array(deadlineHistorySchema) },
    }),
    async request => rules.listDeadlineHistory(request.params.tenant),
  );

  typed.put(
    '/rules/targets/:tenant',
    app.auth.operator({
      tags: ['rules'],
      summary: "Publish a tenant's KPI achievement targets",
      params: tenantParamsSchema,
      body: targetSetSchema,
      response: {
        202: rulesAcceptedSchema,
        400: rulesErrorSchema,
        502: rulesErrorSchema,
      },
    }),
    async (request, reply) =>
      reply.status(202).send(await rules.setTargets(request.params.tenant, request.body)),
  );

  typed.get(
    '/rules/targets/:tenant',
    app.auth.tenant({
      tags: ['rules'],
      summary: "Read this tenant's current KPI targets",
      params: tenantParamsSchema,
      response: { 200: targetSetSchema, 404: rulesErrorSchema },
    }),
    async request => rules.getTargets(request.params.tenant),
  );

  typed.get(
    '/rules/targets/:tenant/history',
    app.auth.tenant({
      tags: ['rules'],
      summary: 'List the last ten published targets, newest first',
      params: tenantParamsSchema,
      response: { 200: z.array(targetHistorySchema) },
    }),
    async request => rules.listTargetHistory(request.params.tenant),
  );
}
