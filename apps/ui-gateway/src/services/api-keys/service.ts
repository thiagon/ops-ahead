import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.ts';

const PREFIX_LENGTH = 8;

/**
 * The clock's credential, and the only one the gateway stores. People and MCP
 * clients authenticate against Authentik; consumers present the run key of the
 * message they received. That leaves the CronJob, which is not a person and
 * has no message.
 */
export class ApiKeysService {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  /** Answers with the plaintext once; only the hash is kept. */
  async issue(kind: 'scheduler' = 'scheduler'): Promise<{ key: string; prefix: string }> {
    const key = randomBytes(32).toString('base64url');
    const prefix = key.slice(0, PREFIX_LENGTH);
    await this.#prisma.apiKey.create({ data: { kind, prefix, hash: hashKey(key) } });
    return { key, prefix };
  }

  /**
   * Records the key the CronJob was handed, so both sides read the same Vault
   * value instead of one minting what the other cannot know. Idempotent on the
   * hash: restarting the gateway re-registers the same key rather than a
   * second one.
   */
  async register(key: string, kind: 'scheduler' = 'scheduler'): Promise<void> {
    const hash = hashKey(key);
    await this.#prisma.apiKey.upsert({
      where: { hash },
      create: { kind, prefix: key.slice(0, PREFIX_LENGTH), hash },
      update: { revokedAt: null },
    });
  }

  /**
   * Whether this is a live key of that kind. Compared by hash lookup, so a
   * wrong key costs one indexed query and reveals nothing by timing.
   */
  async verify(key: string, kind: 'scheduler' = 'scheduler'): Promise<boolean> {
    const row = await this.#prisma.apiKey.findUnique({
      where: { hash: hashKey(key) },
      select: { kind: true, revokedAt: true, hash: true },
    });
    if (!row || row.revokedAt || row.kind !== kind) return false;
    return matches(key, row.hash);
  }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function matches(key: string, storedHex: string): boolean {
  const presented = Buffer.from(hashKey(key), 'hex');
  const stored = Buffer.from(storedHex, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
