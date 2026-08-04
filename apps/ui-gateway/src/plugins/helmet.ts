import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function helmetPlugin(fastify: FastifyInstance) {
  await fastify.register(helmet, { global: true });
}

export default fp(helmetPlugin, { name: 'helmet' });
