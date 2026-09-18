import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createIntegrationSchema,
  deadlineListSchema,
  integrationListSchema,
  integrationSchema,
  kpiTargetListSchema,
  revisionListSchema,
  secretSchema,
  sourceParamsSchema,
  tenantParamsSchema,
  updateBindingsSchema,
  updateDeadlinesSchema,
  updateKpiTargetsSchema,
  upsertMappingSchema,
} from './schema.ts';

/**
 * Until the screens have login, the author recorded on every revision is the
 * service itself — the history is real, its authorship is not
 * (apps/ui-frontend/spec/config-ui.md §6.5).
 */
const ANONYMOUS_AUTHOR = 'anonymous';

export function registerConfigRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['config'];

  typed.get(
    '/tenants/:tenant/integrations',
    {
      schema: {
        tags,
        summary: 'List the tenant integrations',
        params: tenantParamsSchema,
        response: { 200: integrationListSchema },
      },
    },
    async request => ({ items: await app.configService.listIntegrations(request.params.tenant) }),
  );

  typed.get(
    '/tenants/:tenant/integrations/:source',
    {
      schema: {
        tags,
        summary: 'One integration, bindings and mappings included',
        params: sourceParamsSchema,
        response: { 200: integrationSchema },
      },
    },
    async request =>
      await app.configService.getIntegration(request.params.tenant, request.params.source),
  );

  typed.post(
    '/tenants/:tenant/integrations',
    {
      schema: {
        tags,
        summary: 'Create an integration and mint its signing key',
        description: 'The key is in the response and nowhere else — it is never readable again.',
        params: tenantParamsSchema,
        body: createIntegrationSchema,
        response: { 201: integrationSchema.extend({ secret: secretSchema.shape.secret }) },
      },
    },
    async (request, reply) => {
      const { integration, secret } = await app.configService.createIntegration(
        request.params.tenant,
        request.body,
        ANONYMOUS_AUTHOR,
      );
      return reply.status(201).send({ ...integration, secret });
    },
  );

  typed.post(
    '/tenants/:tenant/integrations/:source/secret',
    {
      schema: {
        tags,
        summary: 'Rotate the signing key',
        params: sourceParamsSchema,
        response: { 200: secretSchema },
      },
    },
    async request =>
      await app.configService.rotateSecret(
        request.params.tenant,
        request.params.source,
        ANONYMOUS_AUTHOR,
      ),
  );

  typed.put(
    '/tenants/:tenant/integrations/:source/bindings',
    {
      schema: {
        tags,
        summary: 'Replace where each field is read',
        params: sourceParamsSchema,
        body: updateBindingsSchema,
        response: { 200: integrationSchema },
      },
    },
    async request =>
      await app.configService.updateBindings(
        request.params.tenant,
        request.params.source,
        request.body.bindings,
        ANONYMOUS_AUTHOR,
      ),
  );

  typed.post(
    '/tenants/:tenant/integrations/:source/mappings',
    {
      schema: {
        tags,
        summary: 'Map one origin value to a domain value',
        params: sourceParamsSchema,
        body: upsertMappingSchema,
        response: { 200: integrationSchema },
      },
    },
    async request =>
      await app.configService.upsertMapping(
        request.params.tenant,
        request.params.source,
        request.body,
        ANONYMOUS_AUTHOR,
      ),
  );

  typed.delete(
    '/tenants/:tenant/integrations/:source/mappings/:id',
    {
      schema: {
        tags,
        summary: 'Remove one mapped value',
        params: sourceParamsSchema.extend({ id: sourceParamsSchema.shape.source }),
        response: { 200: integrationSchema },
      },
    },
    async request =>
      await app.configService.removeMapping(
        request.params.tenant,
        request.params.source,
        request.params.id,
        ANONYMOUS_AUTHOR,
      ),
  );

  typed.get(
    '/tenants/:tenant/deadlines',
    {
      schema: {
        tags,
        summary: 'OLA deadlines per severity',
        params: tenantParamsSchema,
        response: { 200: deadlineListSchema },
      },
    },
    async request => ({ items: await app.configService.listDeadlines(request.params.tenant) }),
  );

  typed.put(
    '/tenants/:tenant/deadlines',
    {
      schema: {
        tags,
        summary: 'Replace the OLA deadlines',
        params: tenantParamsSchema,
        body: updateDeadlinesSchema,
        response: { 200: deadlineListSchema },
      },
    },
    async request => ({
      items: await app.configService.replaceDeadlines(
        request.params.tenant,
        request.body.items,
        ANONYMOUS_AUTHOR,
      ),
    }),
  );

  typed.get(
    '/tenants/:tenant/kpi-targets',
    {
      schema: {
        tags,
        summary: 'KPI achievement bands',
        params: tenantParamsSchema,
        response: { 200: kpiTargetListSchema },
      },
    },
    async request => ({ items: await app.configService.listKpiTargets(request.params.tenant) }),
  );

  typed.put(
    '/tenants/:tenant/kpi-targets',
    {
      schema: {
        tags,
        summary: 'Replace the KPI bands',
        params: tenantParamsSchema,
        body: updateKpiTargetsSchema,
        response: { 200: kpiTargetListSchema },
      },
    },
    async request => ({
      items: await app.configService.replaceKpiTargets(
        request.params.tenant,
        request.body.items,
        ANONYMOUS_AUTHOR,
      ),
    }),
  );

  typed.post(
    '/tenants/:tenant/revisions/:id/rollback',
    {
      schema: {
        tags,
        summary: 'Restore the state a revision recorded',
        description:
          'The restore is itself a revision, so it can be reverted in turn. A dictionary revision records one entry rather than the whole set, so it is not restorable this way.',
        params: tenantParamsSchema.extend({ id: z.uuid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await app.configService.rollback(request.params.tenant, request.params.id, ANONYMOUS_AUTHOR);
      return reply.status(204).send(null);
    },
  );

  typed.get(
    '/tenants/:tenant/revisions',
    {
      schema: {
        tags,
        summary: 'Who changed what, most recent first',
        params: tenantParamsSchema,
        response: { 200: revisionListSchema },
      },
    },
    async request => ({ items: await app.configService.listRevisions(request.params.tenant) }),
  );
}
