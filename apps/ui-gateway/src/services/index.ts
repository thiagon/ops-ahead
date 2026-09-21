import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AnalysesService } from './analyses/service.ts';
import { ApiKeysService } from './api-keys/service.ts';
import { EventsService } from './events/service.ts';
import { OidcService } from './oidc/service.ts';
import { RulesService } from './rules/service.ts';
import { SecretCipher } from '../lib/cipher.ts';
import { SourcesService } from './sources/service.ts';
import { TenantsService } from './tenants/service.ts';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      analyses: AnalysesService;
      events: EventsService;
      sources: SourcesService;
      rules: RulesService;
      oidc: OidcService;
      apiKeys: ApiKeysService;
      tenants: TenantsService;
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
    oidc: new OidcService({
      issuer: fastify.env.AUTHENTIK_ISSUER,
      clientId: fastify.env.AUTHENTIK_CLIENT_ID,
      clientSecret: fastify.env.AUTHENTIK_CLIENT_SECRET,
      redirectUri: `${fastify.env.PUBLIC_URL.replace(/\/$/, '')}/auth/callback`,
      introspectionCacheTtlMs: fastify.env.INTROSPECTION_CACHE_TTL_MS,
    }),
    apiKeys: new ApiKeysService(fastify.prisma),
    tenants: new TenantsService(fastify.prisma),
  });

  if (fastify.env.SCHEDULER_API_KEY) {
    await fastify.services.apiKeys.register(fastify.env.SCHEDULER_API_KEY);
  }
}

export default fp(servicesPlugin, {
  name: 'services',
  dependencies: ['env', 'kafka', 'prisma'],
});
