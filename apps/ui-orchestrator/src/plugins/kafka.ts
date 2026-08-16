import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Admin, Consumer, Producer } from 'kafkajs';
import { Kafka, logLevel } from 'kafkajs';

export interface OutboundMessage {
  key: string;
  value: string;
}

export interface EventPublisher {
  publish(topic: string, message: OutboundMessage): Promise<void>;
}

interface ManagedPublisher extends EventPublisher {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

/**
 * Wrap a kafkajs producer as ui-orchestrator's outbound port. Unlike
 * ui-gateway's single-topic publisher, this one publishes to whichever topic
 * the caller names — ui-orchestrator routes to trigger.ml/trigger.data by
 * `analysis`, it never owns a fixed topic. The publisher owns connection
 * state so a broker down at boot — or dropped mid-flight — is reconnected by
 * the next publish instead of leaving a stale producer behind.
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

    async publish(topic, { key, value }) {
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

export interface RunStatusMessage {
  run_id: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  detail?: Record<string, unknown>;
}

export interface RunStatusStore {
  get(runId: string): RunStatusMessage | undefined;
}

interface ManagedStatusConsumer extends RunStatusStore {
  /**
   * Connects, replays trigger.status from the beginning into the in-memory
   * map, and only resolves once every partition has caught up to the offset
   * it had when start() was called — then keeps consuming live in the
   * background. The compacted topic is the source of truth; the map is a
   * disposable read model rebuilt on every restart (see spec.md).
   */
  start(): Promise<void>;
  stop(): Promise<void>;
}

function parseStatusMessage(raw: Buffer | null): RunStatusMessage | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'run_id' in parsed &&
      typeof (parsed as { run_id: unknown }).run_id === 'string'
    ) {
      return parsed as RunStatusMessage;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function createStatusConsumer(
  consumer: Consumer,
  admin: Admin,
  topic: string,
): ManagedStatusConsumer {
  const store = new Map<string, RunStatusMessage>();

  return {
    get(runId) {
      return store.get(runId);
    },

    async start() {
      await admin.connect();
      const partitionOffsets = await admin.fetchTopicOffsets(topic);
      await admin.disconnect();

      // Last offset already written per partition, at the moment we started —
      // everything up to here is "backlog"; anything after is "live".
      const pending = new Map(
        partitionOffsets
          .filter(({ offset, low }) => offset !== low)
          .map(({ partition, offset }) => [partition, String(Number(offset) - 1)]),
      );

      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: true });

      await new Promise<void>((resolve, reject) => {
        if (pending.size === 0) {
          resolve();
        }

        consumer
          .run({
            eachMessage: async ({ partition, message }) => {
              const status = parseStatusMessage(message.value);
              if (status) store.set(status.run_id, status);

              if (pending.get(partition) === message.offset) {
                pending.delete(partition);
                if (pending.size === 0) resolve();
              }
            },
          })
          .catch(reject);
      });
    },

    async stop() {
      await consumer.disconnect();
    },
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    kafka: EventPublisher;
    runStatus: RunStatusStore;
  }
}

async function kafkaPlugin(fastify: FastifyInstance) {
  // Whoever builds the app may hand in its own publisher/store — a test
  // double, or a different transport later. Only the default wiring talks to
  // a broker, and only for whichever half a test didn't already replace.
  const needsPublisher = !fastify.hasDecorator('kafka');
  const needsStatusConsumer = !fastify.hasDecorator('runStatus');
  if (!needsPublisher && !needsStatusConsumer) return;

  const kafka = new Kafka({
    clientId: fastify.env.SERVICE_NAME,
    brokers: fastify.env.KAFKA_BOOTSTRAP_SERVERS.split(',').map(broker => broker.trim()),
    retry: { retries: 3, initialRetryTime: 100, maxRetryTime: 2000 },
    logLevel: logLevel.WARN,
  });

  const publisher = needsPublisher ? createPublisher(kafka.producer()) : undefined;
  if (publisher) fastify.decorate('kafka', publisher);

  const statusConsumer = needsStatusConsumer
    ? createStatusConsumer(
        // A fresh, per-boot group id — never shared across replicas or
        // reused across restarts. trigger.status is compacted and read
        // fromBeginning specifically so every replica rebuilds the same
        // complete map independently; a stable groupId would instead split
        // partitions across replicas (each seeing only part of the history)
        // and, on restart, resume from a committed offset instead of
        // replaying the backlog — silently breaking both guarantees.
        kafka.consumer({ groupId: `${fastify.env.SERVICE_NAME}-status-${randomUUID()}` }),
        kafka.admin(),
        fastify.env.KAFKA_TOPIC_STATUS,
      )
    : undefined;
  if (statusConsumer) fastify.decorate('runStatus', statusConsumer);

  fastify.addHook('onReady', async () => {
    // GET /runs must never answer before the compacted topic's backlog is
    // replayed — otherwise a fresh restart would report every past run as
    // "queued" until its next status update happens to arrive.
    if (statusConsumer) await statusConsumer.start();

    // The producer, unlike the consumer, doesn't block readiness: a caller
    // waits on POST /trigger, so a broker that's down would otherwise trip
    // the onReady timeout and crash-loop the pod. publish() reconnects lazily.
    if (publisher) {
      void publisher.connect().catch(err => {
        fastify.log.warn({ err }, 'kafka producer could not connect at startup');
      });
    }
  });

  fastify.addHook('onClose', async () => {
    if (publisher) await publisher.disconnect();
    if (statusConsumer) await statusConsumer.stop();
  });
}

export default fp(kafkaPlugin, { name: 'kafka', dependencies: ['env'] });
