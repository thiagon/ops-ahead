import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptime: z.number(),
});

function registerHealthRoutes(app: FastifyInstance): void {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: { hide: true, response: { 200: healthResponse } },
    },
    async () => ({
      status: 'ok' as const,
      service: app.env.SERVICE_NAME,
      version: app.env.SERVICE_VERSION,
      uptime: process.uptime(),
    }),
  );
}

export default fp(registerHealthRoutes, { name: 'health-route', dependencies: ['env'] });
