import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function corsPlugin(fastify: FastifyInstance) {
  const origins = fastify.env.CORS_ORIGINS;

  // Reflecting the request origin (not `*`) can carry credentials. The
  // browser calls the gateway directly and must be allowed to send the cookie.
  await fastify.register(cors, {
    origin: origins.length > 0 ? origins : true,
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'authorization', 'x-run-key', 'x-signature'],
  });
}

export default fp(corsPlugin, { name: 'cors', dependencies: ['env'] });
