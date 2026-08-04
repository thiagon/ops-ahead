import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function corsPlugin(fastify: FastifyInstance) {
  const origins = fastify.env.CORS_ORIGINS;

  await fastify.register(cors, { origin: origins.length > 0 ? origins : true });
}

export default fp(corsPlugin, { name: 'cors', dependencies: ['env'] });
