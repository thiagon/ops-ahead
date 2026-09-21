import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function corsPlugin(fastify: FastifyInstance) {
  const origins = fastify.env.CORS_ORIGINS;

  // `credentials` and a wildcard origin are mutually exclusive by spec, so a
  // reflected origin is only offered when no list pins it down.
  await fastify.register(cors, {
    origin: origins.length > 0 ? origins : true,
    credentials: origins.length > 0,
    allowedHeaders: ['content-type', 'x-csrf-token', 'authorization', 'x-run-key', 'x-signature'],
  });
}

export default fp(corsPlugin, { name: 'cors', dependencies: ['env'] });
