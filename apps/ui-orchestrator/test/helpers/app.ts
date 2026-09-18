import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  const app = buildApp({ logger: false });
  extend?.(app);
  stubKafka(app);
  await app.ready();
  return app;
}

/**
 * No test reaches a broker: unless the test provided its own publisher/
 * consumers, the app gets ones that swallow publishes and never deliver a
 * message — a run's status is seeded directly via `app.runsService`
 * (decorated in modules/runs/index.ts) instead of through Kafka.
 */
export function stubKafka(app: FastifyInstance): void {
  if (!app.hasDecorator('kafka')) {
    app.decorate('kafka', { publish: async () => undefined });
  }
  if (!app.hasDecorator('kafkaConsumers')) {
    app.decorate('kafkaConsumers', { consumeWithBacklogReplay: async () => undefined });
  }
}
