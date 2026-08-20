import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Counter, collectDefaultMetrics, Registry } from 'prom-client';

export interface Metrics {
  registry: Registry;
  eventsPublished: Counter<'source' | 'intake'>;
  publishFailures: Counter<'source' | 'intake'>;
  signatureFailures: Counter<'reason' | 'tenant_id' | 'source'>;
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: Metrics;
  }
}

/**
 * The instrumentation the gateway publishes, on a registry of its own instead
 * of the prom-client global one — /metrics then exposes exactly what this app
 * declares, and each app instance starts from zero.
 */
function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return {
    registry,

    eventsPublished: new Counter({
      name: 'gateway_events_published_total',
      help: 'Incident envelopes published to the bus',
      labelNames: ['source', 'intake'],
      registers: [registry],
    }),

    publishFailures: new Counter({
      name: 'gateway_publish_failures_total',
      help: 'Incident envelopes the gateway could not publish to the bus',
      labelNames: ['source', 'intake'],
      registers: [registry],
    }),

    signatureFailures: new Counter({
      name: 'gateway_signature_failures_total',
      help: 'Requests rejected by HMAC signature verification',
      labelNames: ['reason', 'tenant_id', 'source'],
      registers: [registry],
    }),
  };
}

async function metricsPlugin(fastify: FastifyInstance) {
  fastify.decorate('metrics', createMetrics());
}

export default fp(metricsPlugin, { name: 'metrics' });
