import { join } from 'node:path';
import autoload from '@fastify/autoload';
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Fastify's 10s default onReady timeout is too tight for the kafka
    // plugin's backlog replay (connect + group join + fetch offsets +
    // subscribe) under real broker latency — see src/plugins/kafka.ts.
    pluginTimeout: 30_000,
    ...options,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(autoload, { dir: join(import.meta.dirname, 'plugins') });
  app.register(autoload, { dir: join(import.meta.dirname, 'modules') });

  return app;
}
