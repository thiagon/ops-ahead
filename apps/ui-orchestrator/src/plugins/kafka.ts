import { randomUUID } from 'node:crypto';
import { Consumer, Producer } from '@platformatic/kafka';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { RunStatus } from '../modules/runs/schema.ts';

export interface OutboundMessage {
  key: string;
  value: string;
}

export interface EventPublisher {
  publish(topic: string, message: OutboundMessage): Promise<void>;
}

export interface RunStatusStore {
  get(runId: string): RunStatus | undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    kafka: EventPublisher;
    runStatus: RunStatusStore;
  }
}

export function parseStatusMessage(raw: Buffer | undefined): RunStatus | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'run_id' in parsed &&
      typeof (parsed as { run_id: unknown }).run_id === 'string'
    ) {
      return parsed as RunStatus;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * The offset of the last message already written per partition, at the
 * moment we asked — everything up to here is "backlog" to replay before
 * ui-orchestrator answers traffic; anything after is "live". A partition
 * with a high watermark of 0 has never had a message, so it's excluded —
 * nothing will ever arrive to satisfy it.
 */
export function backlogTargets(watermarks: readonly bigint[]): Map<number, bigint> {
  const targets = new Map<number, bigint>();
  watermarks.forEach((high, partition) => {
    if (high > 0n) targets.set(partition, high - 1n);
  });
  return targets;
}

async function kafkaPlugin(fastify: FastifyInstance) {
  // Whoever builds the app may hand in its own publisher/store — a test
  // double, or a different transport later. Only the default wiring talks to
  // a broker, and only for whichever half a test didn't already replace.
  const needsPublisher = !fastify.hasDecorator('kafka');
  const needsStatusConsumer = !fastify.hasDecorator('runStatus');
  if (!needsPublisher && !needsStatusConsumer) return;

  const bootstrapBrokers = fastify.env.KAFKA_BOOTSTRAP_SERVERS.split(',').map(broker =>
    broker.trim(),
  );

  if (needsPublisher) {
    // ui-orchestrator routes to trigger.ml/trigger.data by `analysis` — it
    // never owns a fixed topic, so the topic travels per publish() call
    // rather than living in the client config.
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

  if (needsStatusConsumer) {
    const store = new Map<string, RunStatus>();
    fastify.decorate('runStatus', {
      get: (runId: string) => store.get(runId),
    });

    const topic = fastify.env.KAFKA_TOPIC_STATUS;
    const consumer = new Consumer({
      clientId: fastify.env.SERVICE_NAME,
      bootstrapBrokers,
      // A fresh, per-boot group id — never shared across replicas or reused
      // across restarts. trigger.status is compacted and read from the
      // beginning specifically so every replica rebuilds the same complete
      // map independently; a stable groupId would instead split partitions
      // across replicas (each seeing only part of the history) and, on
      // restart, resume from a committed offset instead of replaying the
      // backlog — silently breaking both guarantees.
      groupId: `${fastify.env.SERVICE_NAME}-status-${randomUUID()}`,
    });

    fastify.addHook('onReady', async () => {
      // GET /runs must never answer before the compacted topic's backlog is
      // replayed — otherwise a fresh restart would report every past run as
      // "queued" until its next status update happens to arrive.
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
            const status = parseStatusMessage(message.value);
            if (status) store.set(status.run_id, status);

            if (pending.get(message.partition) === message.offset) {
              pending.delete(message.partition);
              if (pending.size === 0) resolve();
            }
          }
        })().catch(reject);
      });
    });

    fastify.addHook('onClose', async () => {
      await consumer.close();
    });
  }
}

export default fp(kafkaPlugin, { name: 'kafka', dependencies: ['env'] });
