import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

async function helmetPlugin(fastify: FastifyInstance) {
  const https = fastify.env.HTTPS_ENABLED;

  await fastify.register(helmet, {
    global: true,
    // Over plain HTTP these only make the browser chase a scheme nothing serves.
    hsts: https,
    crossOriginOpenerPolicy: https,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: https ? {} : { 'upgrade-insecure-requests': null },
    },
  });
}

export default fp(helmetPlugin, { name: 'helmet', dependencies: ['env'] });
