import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { type Env, envSchema } from '#env.ts';

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
  }
}

async function configPlugin(fastify: FastifyInstance) {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    fastify.log.error(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      'invalid env configuration',
    );
    process.exit(1);
  }
  fastify.decorate('env', parsed.data);
}

export default fp(configPlugin, { name: 'env' });
