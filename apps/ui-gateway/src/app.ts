import { join } from 'node:path';
import autoload from '@fastify/autoload';
import fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    ...options,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.register(autoload, { dir: join(import.meta.dirname, 'plugins') });
  // index.ts only — autoload would otherwise treat each services/<name> folder as a plugin
  app.register(autoload, { dir: join(import.meta.dirname, 'services'), maxDepth: 0 });
  app.register(autoload, { dir: join(import.meta.dirname, 'modules') });

  return app;
}
