import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AnalysesService } from './analyses/service.ts';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      analyses: AnalysesService;
    };
  }
}

async function servicesPlugin(fastify: FastifyInstance) {
  if (fastify.hasDecorator('services')) return;

  fastify.decorate('services', {
    analyses: new AnalysesService(fastify.prisma, fastify.kafka, {
      ml: fastify.env.KAFKA_TOPIC_ML,
      data: fastify.env.KAFKA_TOPIC_DATA,
    }),
  });
}

export default fp(servicesPlugin, {
  name: 'services',
  dependencies: ['env', 'kafka', 'prisma'],
});
