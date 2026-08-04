import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';

async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'invalid request',
        details: error.validation.map(issue => ({
          path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
          message: issue.message,
        })),
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response does not match route schema');
      return reply.status(500).send({ error: 'InternalServerError', message: 'internal error' });
    }

    const err = error as FastifyError;
    const status = err.statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send({ error: err.name, message: err.message });
    }

    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'InternalServerError', message: 'internal error' });
  });

  fastify.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: 'NotFound',
      message: `route ${request.method} ${request.url} not found`,
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
