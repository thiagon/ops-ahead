import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { runParamsSchema, runStatusSchema } from './schema.ts';
import { getRunStatus } from './service.ts';

export function registerRunRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/runs/:run_id',
    {
      schema: {
        tags: ['runs'],
        summary: 'Look up a run status',
        description:
          'Reflects the status last published to trigger.status — never queries Kubernetes. Survives an ui-orchestrator restart: the map is rehydrated from the compacted topic on startup.',
        params: runParamsSchema,
        response: { 200: runStatusSchema },
      },
    },
    async request => getRunStatus(request.server, request.params.run_id),
  );
}
