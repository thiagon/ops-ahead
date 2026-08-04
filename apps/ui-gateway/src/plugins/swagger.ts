import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

async function swaggerPlugin(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: fastify.env.SERVICE_NAME,
        version: fastify.env.SERVICE_VERSION,
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
    // The UI overrides helmet's CSP on /docs, so it is settled again here.
    staticCSP: true,
    transformStaticCSP: header => {
      const csp = header.replace(
        "style-src 'self' https:",
        "style-src 'self' https: 'unsafe-inline'",
      );
      return fastify.env.HTTPS_ENABLED ? csp : csp.replace(/\s*upgrade-insecure-requests;/, '');
    },
  });
}

export default fp(swaggerPlugin, { name: 'swagger', dependencies: ['env'] });
