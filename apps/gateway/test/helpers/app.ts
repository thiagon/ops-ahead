import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  const app = buildApp({ logger: false });
  extend?.(app);
  await app.ready();
  return app;
}
