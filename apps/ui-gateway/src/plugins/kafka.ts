import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Kafka, logLevel, type Producer } from 'kafkajs';

export interface OutboundMessage {
  topic: string;
  key: string;
  value: string;
}

export interface EventPublisher {
  publish(message: OutboundMessage): Promise<void>;
}

interface ManagedPublisher extends EventPublisher {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    kafka: EventPublisher;
  }
}

/**
 * Wrap a kafkajs producer as the gateway's outbound port. The topic is per
 * message, not fixed at construction: the gateway publishes to a different
 * raw topic per intake nature (domain/ubiquitous-language.md#intake), and one
 * producer serves all of them. The publisher owns the connection state so a
 * broker that was down when the app started — or dropped mid-flight — is
 * reconnected by the next publish instead of leaving a stale producer behind.
 * Callers see only publish, and a rejection means the event did not reach the
 * topic.
 */
export function createPublisher(producer: Producer): ManagedPublisher {
  let connected = false;

  async function connect(): Promise<void> {
    if (connected) return;
    await producer.connect();
    connected = true;
  }

  return {
    connect,

    async disconnect() {
      if (!connected) return;
      connected = false;
      await producer.disconnect();
    },

    async publish({ topic, key, value }) {
      try {
        await connect();
        await producer.send({ topic, acks: -1, messages: [{ key, value }] });
      } catch (err) {
        connected = false;
        throw err;
      }
    },
  };
}

async function kafkaPlugin(fastify: FastifyInstance) {
  // Whoever builds the app may hand in its own publisher — a test double, or a
  // different transport later. Only the default wiring talks to a broker.
  if (fastify.hasDecorator('kafka')) return;

  const kafka = new Kafka({
    clientId: fastify.env.SERVICE_NAME,
    brokers: fastify.env.KAFKA_BOOTSTRAP_SERVERS.split(',').map(broker => broker.trim()),
    // A webhook caller waits on this: retry the broker a few times, then give
    // it back a 502 instead of holding the request for half a minute.
    retry: { retries: 3, initialRetryTime: 100, maxRetryTime: 2000 },
    logLevel: logLevel.WARN,
  });

  const publisher = createPublisher(kafka.producer());
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
