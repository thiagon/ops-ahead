import closeWithGrace from 'close-with-grace';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function closeWithGracePlugin(fastify: FastifyInstance) {
  closeWithGrace({ delay: 10000 }, async ({ signal, err }) => {
    if (err) fastify.log.error({ err }, 'shutdown failed');
    else fastify.log.debug({ signal }, 'graceful shutdown');
    await fastify.close();
  });
}

export default fp(closeWithGracePlugin, { name: 'close-with-grace' });
