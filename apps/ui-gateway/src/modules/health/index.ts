import fp from 'fastify-plugin';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponse = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptime: z.number(),
});

export default fp(
  async app => {
    app.withTypeProvider<ZodTypeProvider>().get(
      '/health',
      {
        schema: {
          tags: ['health'],
          response: { 200: healthResponse },
        },
      },
      async () => ({
        status: 'ok' as const,
        service: app.env.SERVICE_NAME,
        version: app.env.SERVICE_VERSION,
        uptime: process.uptime(),
      }),
    );
  },
  { name: 'health', dependencies: ['env'] },
);
