import { randomUUID } from 'node:crypto';
import { Consumer, type Message, Producer } from '@platformatic/kafka';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface OutboundMessage {
  key: string;
  value: string;
}

export interface EventPublisher {
  publish(topic: string, message: OutboundMessage): Promise<void>;
}

export interface KafkaConsumers {
  /**
   * Hands every message, backlog and live alike, to `onMessage`, resolving
   * once the backlog at call time (see `backlogTargets`) has been replayed.
   * `groupId` is fresh per call — never shared across replicas or reused
   * across restarts, or a restart would resume from a committed offset
   * instead of replaying the backlog.
   */
  consumeWithBacklogReplay(topic: string, onMessage: (message: Message) => void): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    kafka: EventPublisher;
    kafkaConsumers: KafkaConsumers;
  }
}

/**
 * Last written offset per partition — the backlog to replay before "live".
 * A watermark of 0 means the partition never had a message, so it's excluded.
 */
export function backlogTargets(watermarks: readonly bigint[]): Map<number, bigint> {
  const targets = new Map<number, bigint>();
  watermarks.forEach((high, partition) => {
    if (high > 0n) targets.set(partition, high - 1n);
  });
  return targets;
}

async function kafkaPlugin(fastify: FastifyInstance) {
  // A test may hand in its own publisher/consumers; only the missing half gets real Kafka wiring.
  const needsPublisher = !fastify.hasDecorator('kafka');
  const needsConsumers = !fastify.hasDecorator('kafkaConsumers');
  if (!needsPublisher && !needsConsumers) return;

  const bootstrapBrokers = fastify.env.KAFKA_BOOTSTRAP_SERVERS.split(',').map(broker =>
    broker.trim(),
  );

  if (needsPublisher) {
    // Topic travels per publish() call, not the client config — ui-orchestrator never owns one fixed topic.
    const producer = new Producer({
      clientId: fastify.env.SERVICE_NAME,
      bootstrapBrokers,
    });

    fastify.decorate('kafka', {
      async publish(topic, { key, value }) {
        await producer.send({
          messages: [{ topic, key: Buffer.from(key), value: Buffer.from(value) }],
        });
      },
    });

    fastify.addHook('onClose', async () => {
      await producer.close();
    });
  }

  if (needsConsumers) {
    const openConsumers: Consumer[] = [];

    fastify.decorate('kafkaConsumers', {
      async consumeWithBacklogReplay(topic, onMessage) {
        const consumer = new Consumer({
          clientId: fastify.env.SERVICE_NAME,
          bootstrapBrokers,
          groupId: `${fastify.env.SERVICE_NAME}-${topic}-${randomUUID()}`,
        });
        openConsumers.push(consumer);

        const watermarks = (await consumer.listOffsets({ topics: [topic] })).get(topic) ?? [];
        const pending = backlogTargets(watermarks);

        const stream = await consumer.consume({
          topics: [topic],
          mode: 'earliest',
          autocommit: false,
        });

        await new Promise<void>((resolve, reject) => {
          if (pending.size === 0) resolve();

          (async () => {
            for await (const message of stream) {
              onMessage(message);

              if (pending.get(message.partition) === message.offset) {
                pending.delete(message.partition);
                if (pending.size === 0) resolve();
              }
            }
          })().catch(reject);
        });
      },
    });

    fastify.addHook('onClose', async () => {
      await Promise.all(openConsumers.map(consumer => consumer.close()));
    });
  }
}

export default fp(kafkaPlugin, { name: 'kafka', dependencies: ['env'] });
