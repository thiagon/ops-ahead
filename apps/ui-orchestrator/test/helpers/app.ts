import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { RunStatus } from '../../src/modules/runs/schema.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  const app = buildApp({ logger: false });
  extend?.(app);
  stubKafka(app);
  await app.ready();
  return app;
}

/**
 * No test reaches a broker: unless the test provided its own publisher/store,
 * the app gets ones that swallow publishes and start out empty.
 */
export function stubKafka(app: FastifyInstance): void {
  if (!app.hasDecorator('kafka')) {
    app.decorate('kafka', { publish: async () => undefined });
  }
  if (!app.hasDecorator('runStatus')) {
    const store = new Map<string, RunStatus>();
    app.decorate('runStatus', { get: (runId: string) => store.get(runId) });
  }
}
