import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { createPublisher, type EventPublisher } from '../lib/kafka.ts';

declare module 'fastify' {
  interface FastifyInstance {
    kafka: EventPublisher;
  }
}

async function kafkaPlugin(fastify: FastifyInstance) {
  // Whoever builds the app may hand in its own publisher — a test double, or a
  // different transport later. Only the default wiring talks to a broker.
  if (fastify.hasDecorator('kafka')) return;

  const publisher = createPublisher({
    clientId: fastify.env.SERVICE_NAME,
    brokers: fastify.env.KAFKA_BOOTSTRAP_SERVERS,
  });
  fastify.decorate('kafka', publisher);

  fastify.addHook('onReady', async () => {
    // Warm the connection without waiting on it: a broker that is down would
    // otherwise trip the onReady timeout and crash-loop the pod. The gateway
    // comes up, /health answers, and the first publish reconnects — or 502s.
    void publisher.connect().catch(err => {
      fastify.log.warn({ err }, 'kafka producer could not connect at startup');
    });
  });

  fastify.addHook('onClose', async () => {
    await publisher.disconnect();
  });
}

export default fp(kafkaPlugin, { name: 'kafka', dependencies: ['env'] });
