import { Kafka, logLevel } from 'kafkajs';

export interface OutboundMessage {
  topic: string;
  key: string;
  value: string;
}

export interface EventPublisher {
  publish(message: OutboundMessage): Promise<void>;
}

export interface ManagedPublisher extends EventPublisher {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface PublisherOptions {
  clientId: string;
  brokers: string;
}

/**
 * One producer, topic per message. Owns the Kafka client so callers pass
 * clientId and a comma-separated broker list — nothing from kafkajs.
 * A broker that was down at start, or dropped mid-flight, is reconnected
 * by the next publish instead of leaving a stale producer behind. A
 * rejection means the event did not reach the topic.
 */
export function createPublisher({ clientId, brokers }: PublisherOptions): ManagedPublisher {
  const kafka = new Kafka({
    clientId,
    brokers: brokers
      .split(',')
      .map(broker => broker.trim())
      .filter(Boolean),
    retry: { retries: 3, initialRetryTime: 100, maxRetryTime: 2000 },
    logLevel: logLevel.WARN,
  });
  const producer = kafka.producer();
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
