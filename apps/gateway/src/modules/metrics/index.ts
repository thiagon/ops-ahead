import fp from 'fastify-plugin';

export default fp(
  async app => {
    // Scraped by Prometheus inside the cluster, so it stays out of /docs.
    app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
      const { registry } = app.metrics;
      return reply.type(registry.contentType).send(await registry.metrics());
    });
  },
  { name: 'metrics-route', dependencies: ['metrics'] },
);
