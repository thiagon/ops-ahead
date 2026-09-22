import { Kafka, logLevel } from 'kafkajs';

export interface OutboundMessage {
  topic: string;
  key: string;
  value: string;
}

export interface EventPublisher {
  publish(message: OutboundMessage): Promise<void>;
  /** Many messages, one Produce request per topic. `publish` stays one message. */
  publishBatch(messages: OutboundMessage[]): Promise<void>;
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
 *
 * `publish` sends one message. `publishBatch` sends the list in one Produce
 * request per topic.
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

  function groupsOf(messages: OutboundMessage[]): Map<string, OutboundMessage[]> {
    const groups = new Map<string, OutboundMessage[]>();
    for (const message of messages) {
      const group = groups.get(message.topic);
      if (group) group.push(message);
      else groups.set(message.topic, [message]);
    }
    return groups;
  }

  async function sendAll(messages: OutboundMessage[]): Promise<void> {
    await Promise.all(
      [...groupsOf(messages).entries()].map(([topic, items]) =>
        producer.send({
          topic,
          acks: -1,
          messages: items.map(({ key, value }) => ({ key, value })),
        }),
      ),
    );
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

    async publishBatch(messages) {
      if (messages.length === 0) return;
      try {
        await connect();
        await sendAll(messages);
      } catch (err) {
        connected = false;
        throw err;
      }
    },
  };
}
