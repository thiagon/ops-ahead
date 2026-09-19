import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import { OriginRegistry } from '../../src/plugins/origin-registry.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  const app = buildApp({ logger: false });
  extend?.(app);
  stubKafka(app);
  stubOrigins(app);
  await app.ready();
  return app;
}

/**
 * The credential the ITSM loop has always run on. A test that needs another
 * origin decorates `origins` itself before this fills in.
 */
export const TEST_CREDENTIAL = {
  tenantId: 'locaweb',
  source: 'itsm',
  intake: 'alert' as const,
  envelopeVersion: 'v1',
  hmacSecretEnv: 'HMAC_SECRET_LOCAWEB_ITSM',
};

/** No test reaches a broker to rehydrate the accepted origins. */
export function stubOrigins(app: FastifyInstance): void {
  if (app.hasDecorator('origins')) return;
  const registry = new OriginRegistry();
  registry.record(TEST_CREDENTIAL);
  app.decorate('origins', registry);
}

/**
 * No test reaches a broker: unless the test provided its own publisher, the app
 * gets one that swallows the event.
 */
export function stubKafka(app: FastifyInstance): void {
  if (app.hasDecorator('kafka')) return;
  app.decorate('kafka', { publish: async () => undefined });
}
