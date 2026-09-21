import { randomBytes } from 'node:crypto';
import swagger from '@fastify/swagger';
import apiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  createJsonSchemaTransform,
  createJsonSchemaTransformObject,
} from 'fastify-type-provider-zod';
import createError from 'http-errors';

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

function cspHeader(reply: FastifyReply): string {
  const header = reply.getHeader('content-security-policy');
  if (Array.isArray(header)) {
    return header.join(';');
  }
  return String(header ?? '');
}

async function swaggerPlugin(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: fastify.env.SERVICE_NAME,
        version: fastify.env.SERVICE_VERSION,
      },
      components: { securitySchemes: fastify.auth.schemes },
    },
    transform: createJsonSchemaTransform({ zodToJsonConfig }),
    transformObject: createJsonSchemaTransformObject({ zodToJsonConfig }),
  });

  // Scalar stamps this onto the bootstrap <script>; it is read once at register time.
  const docsNonce = randomBytes(16).toString('hex');

  await fastify.register(apiReference, {
    routePrefix: '/docs',
    openApiDocumentEndpoints: { json: '/json', yaml: '/yaml' },
    configuration: { nonce: docsNonce },
    hooks: {
      onRequest(request, reply, done) {
        // /docs is behind a session: a probe and a webhook have no cookie,
        // and the reference is not a public surface.
        if (request.auth?.kind !== 'user') {
          done(createError.Unauthorized('this endpoint needs a logged-in caller'));
          return;
        }
        const header = cspHeader(reply);
        if (header.includes('script-src')) {
          reply.header(
            'content-security-policy',
            header.replace(/script-src [^;]+/, `script-src 'self' 'nonce-${docsNonce}'`),
          );
        }
        done();
      },
    },
  });
}

export default fp(swaggerPlugin, { name: 'swagger', dependencies: ['env', 'auth'] });
