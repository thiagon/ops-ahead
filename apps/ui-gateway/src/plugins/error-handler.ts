import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import createError from 'http-errors';

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
      return sendHttpError(reply, createError.InternalServerError('internal error'));
    }

    if (createError.isHttpError(error)) {
      if (!error.expose) request.log.error({ err: error }, error.message);
      return sendHttpError(reply, error);
    }

    const err = error as FastifyError;
    const status = err.statusCode ?? 500;
    if (status < 500) {
      return reply.status(status).send({ error: err.name, message: err.message });
    }

    request.log.error({ err }, 'unhandled error');
    return sendHttpError(reply, createError.InternalServerError('internal error'));
  });

  fastify.setNotFoundHandler(request => {
    throw createError.NotFound(`route ${request.method} ${request.url} not found`);
  });
}

function sendHttpError(reply: FastifyReply, error: createError.HttpError) {
  return reply.status(error.statusCode).send({ error: error.name, message: error.message });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
