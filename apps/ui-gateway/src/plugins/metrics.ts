import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Counter, collectDefaultMetrics, Registry } from 'prom-client';

export interface Metrics {
  registry: Registry;
  eventsPublished: Counter<'source'>;
  publishFailures: Counter<'source'>;
  signatureFailures: Counter<'reason'>;
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
      help: 'Incident events normalized and published to the bus',
      labelNames: ['source'],
      registers: [registry],
    }),

    publishFailures: new Counter({
      name: 'gateway_publish_failures_total',
      help: 'Incident events the gateway could not publish to the bus',
      labelNames: ['source'],
      registers: [registry],
    }),

    signatureFailures: new Counter({
      name: 'gateway_signature_failures_total',
      help: 'Requests rejected by HMAC signature verification',
      labelNames: ['reason'],
      registers: [registry],
    }),
  };
}

async function metricsPlugin(fastify: FastifyInstance) {
  fastify.decorate('metrics', createMetrics());
}

export default fp(metricsPlugin, { name: 'metrics' });
