import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../helpers/app.ts';

describe('error handler', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => {
      instance.get('/boom-4xx', async () => {
        throw instance.httpErrors.conflict('already exists');
      });
      instance.get('/boom-5xx', async () => {
        throw new Error('database credentials are wrong');
      });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers unknown routes with the not-found envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: 'NotFoundError',
      message: 'route GET /does-not-exist not found',
    });
  });

  it('maps thrown http errors to their status and name', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-4xx' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'ConflictError', message: 'already exists' });
  });

  it('hides unexpected errors behind a 500 envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom-5xx' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'InternalServerError', message: 'internal error' });
  });
});
