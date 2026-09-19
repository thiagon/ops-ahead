import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

function registerMetricsRoutes(app: FastifyInstance): void {
  // Scraped by Prometheus inside the cluster, so it stays out of /docs.
  app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    const { registry } = app.metrics;
    return reply.type(registry.contentType).send(await registry.metrics());
  });
}

export default fp(registerMetricsRoutes, { name: 'metrics-route', dependencies: ['metrics'] });
