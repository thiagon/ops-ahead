import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AnalysesService } from './analyses/service.ts';
import { RulesService } from './rules/service.ts';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      analyses: AnalysesService;
      rules: RulesService;
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
    rules: new RulesService(fastify.kafka, {
      mapping: fastify.env.KAFKA_TOPIC_RULES_MAPPING,
      deadline: fastify.env.KAFKA_TOPIC_RULES_DEADLINE,
      target: fastify.env.KAFKA_TOPIC_RULES_TARGET,
    }),
  });
}

export default fp(servicesPlugin, {
  name: 'services',
  dependencies: ['env', 'kafka', 'prisma'],
});
