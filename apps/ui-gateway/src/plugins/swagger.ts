import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
} from 'fastify-type-provider-zod';

/** z.codec is the HTTP Date bridge; OpenAPI only has the wire type (ISO-8601). */
const zodToJsonConfig = {
  override(ctx: {
    zodSchema: { _zod: { def: { type: string } } };
    jsonSchema: { type?: string; format?: string; anyOf?: object[] };
  }) {
    if (ctx.zodSchema._zod.def.type === 'codec') {
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.format = 'date-time';
    }
    if (ctx.zodSchema._zod.def.type === 'union' && ctx.jsonSchema.anyOf) {
      ctx.jsonSchema.anyOf = ctx.jsonSchema.anyOf.filter(schema => Object.keys(schema).length > 0);
    }
    if (ctx.zodSchema._zod.def.type === 'date') {
      ctx.jsonSchema.type = 'string';
      ctx.jsonSchema.format = 'date-time';
    }
  },
};

async function swaggerPlugin(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: fastify.env.SERVICE_NAME,
        version: fastify.env.SERVICE_VERSION,
      },
    },
    transform: createJsonSchemaTransform({ zodToJsonConfig }),
    transformObject: createJsonSchemaTransformObject({ zodToJsonConfig }),
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
