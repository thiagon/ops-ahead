import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AnalysesService } from './analyses/service.ts';
import { EventsService } from './events/service.ts';
import { RulesService } from './rules/service.ts';
import { SecretCipher } from './sources/cipher.ts';
import { SourcesService } from './sources/service.ts';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      analyses: AnalysesService;
      events: EventsService;
      sources: SourcesService;
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
    events: new EventsService(fastify.kafka, {
      alert: fastify.env.KAFKA_TOPIC_RAW_ALERT,
      monitor: fastify.env.KAFKA_TOPIC_RAW_MONITOR,
    }),
    sources: new SourcesService(
      fastify.prisma,
      new SecretCipher(fastify.env.SOURCE_SECRET_KEY),
      fastify.env.SOURCE_CACHE_TTL_MS,
    ),
    rules: new RulesService(
      fastify.kafka,
      {
        mapping: fastify.env.KAFKA_TOPIC_RULES_MAPPING,
        deadline: fastify.env.KAFKA_TOPIC_RULES_DEADLINE,
        target: fastify.env.KAFKA_TOPIC_RULES_TARGET,
      },
      fastify.prisma,
    ),
  });
}

export default fp(servicesPlugin, {
  name: 'services',
  dependencies: ['env', 'kafka', 'prisma'],
});
