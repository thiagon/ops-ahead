import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Kafka, logLevel } from 'kafkajs';
/**
 * Every credential the gateway accepts. One entry per (tenant, source): the
 * route identifies the source system, the secret identifies the tenant — an
 * attacker cannot claim a tenant without that tenant's secret, so tenant_id in
 * the envelope is authoritative from the signature check, never from the URL
 * or the payload (domain/ubiquitous-language.md#tenant).
 */
export interface OriginCredential {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  envelopeVersion: string;
  /** Name of the env var carrying this credential's HMAC secret. */
  hmacSecretEnv: string;
}

/**
 * The origins the gateway accepts, as configured through the screens rather
 * than in code. Rehydrated from the compacted config.origin topic before the
 * app answers, so a gateway with no configuration fails readiness instead of
 * silently accepting nothing.
 */
export class OriginRegistry {
  private readonly credentials = new Map<string, OriginCredential>();

  record(credential: OriginCredential): void {
    this.credentials.set(`${credential.tenantId}:${credential.source}`, credential);
  }

  forget(tenantId: string, source: string): void {
    this.credentials.delete(`${tenantId}:${source}`);
  }

  find(tenantId: string, source: string): OriginCredential | undefined {
    return this.credentials.get(`${tenantId}:${source}`);
  }

  get size(): number {
    return this.credentials.size;
  }
}

/** Never throws — a malformed record must not stop the rehydration loop. */
export function parseOriginMessage(raw: Buffer | null): OriginCredential | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
    const { tenant_id, source, intake, envelope_version, enabled } = parsed;
    if (
      typeof tenant_id !== 'string' ||
      typeof source !== 'string' ||
      (intake !== 'alert' && intake !== 'monitor') ||
      typeof envelope_version !== 'string' ||
      enabled === false
    ) {
      return undefined;
    }
    return {
      tenantId: tenant_id,
      source,
      intake,
      envelopeVersion: envelope_version,
      // Named after the origin, so a new integration needs no code change —
      // only the ExternalSecret that projects its key into the pod.
      hmacSecretEnv: `HMAC_SECRET_${tenant_id}_${source}`.toUpperCase(),
    };
  } catch {
    return undefined;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    origins: OriginRegistry;
  }
}

// Awaited in the plugin body, blocking app.ready(): a webhook must never be
// answered before the backlog is replayed, or a configured origin would get a
// 404 until its next configuration change happens to arrive.
async function originRegistryPlugin(fastify: FastifyInstance) {
  if (fastify.hasDecorator('origins')) return;

  const registry = new OriginRegistry();
  fastify.decorate('origins', registry);

  const kafka = new Kafka({
    clientId: fastify.env.SERVICE_NAME,
    brokers: fastify.env.KAFKA_BOOTSTRAP_SERVERS.split(',').map(broker => broker.trim()),
    logLevel: logLevel.WARN,
  });

  // Unique per boot: every replica needs the whole log, not a partition of it.
  const consumer = kafka.consumer({
    groupId: `${fastify.env.SERVICE_NAME}-config-origin-${crypto.randomUUID()}`,
  });

  await consumer.connect();
  await consumer.subscribe({ topic: fastify.env.KAFKA_TOPIC_CONFIG_ORIGIN, fromBeginning: true });

  const offsets = await kafka.admin().fetchTopicOffsets(fastify.env.KAFKA_TOPIC_CONFIG_ORIGIN);
  const pending = new Map(
    offsets
      .filter(offset => BigInt(offset.high) > 0n)
      .map(offset => [offset.partition, BigInt(offset.high) - 1n]),
  );

  await new Promise<void>((resolve, reject) => {
    if (pending.size === 0) resolve();

    consumer
      .run({
        eachMessage: async ({ partition, message }) => {
          const credential = parseOriginMessage(message.value);
          if (credential) registry.record(credential);
          // A record that no longer describes an accepted origin — disabled,
          // or a tombstone — removes it.
          else if (message.key) {
            const [tenantId, source] = message.key.toString('utf8').split(':');
            if (tenantId && source) registry.forget(tenantId, source);
          }

          if (pending.get(partition) === BigInt(message.offset)) {
            pending.delete(partition);
            if (pending.size === 0) resolve();
          }
        },
      })
      .catch(reject);
  });

  fastify.addHook('onClose', async () => {
    await consumer.disconnect();
  });
}

export default fp(originRegistryPlugin, { name: 'origins', dependencies: ['env'] });
