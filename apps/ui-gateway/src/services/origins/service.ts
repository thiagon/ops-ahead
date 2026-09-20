import createError from 'http-errors';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { generateSecret, type SecretCipher } from './cipher.ts';
import { OriginStore } from './store.ts';

export interface AcceptedOrigin {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  /** Decrypted for the signature check, never for a response body. */
  secret: string;
}

/** What a caller sees: the same record, minus the secret. */
export interface OriginSummary {
  tenant_id: string;
  source: string;
  intake: 'alert' | 'monitor';
}

interface CacheEntry {
  origin: AcceptedOrigin | null;
  expiresAt: number;
}

/**
 * The origins the gateway accepts. Read per request rather than replayed at
 * boot, so a newly registered origin starts working on its own and a database
 * that is down fails the request instead of the pod.
 *
 * The short cache is what keeps a replay — 122k events over one origin — from
 * becoming 122k queries. It also caches the misses, so an address nobody
 * configured cannot be used to hammer the database.
 */
export class OriginsService {
  #store: OriginStore;
  #cipher: SecretCipher;
  #ttlMs: number;
  #cache = new Map<string, CacheEntry>();

  constructor(prisma: PrismaClient, cipher: SecretCipher, ttlMs: number) {
    this.#store = new OriginStore(prisma);
    this.#cipher = cipher;
    this.#ttlMs = ttlMs;
  }

  async find(tenantId: string, source: string): Promise<AcceptedOrigin | undefined> {
    const key = `${tenantId}:${source}`;
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.origin ?? undefined;

    const row = await this.#store.find(tenantId, source);
    const origin = row
      ? {
          tenantId: row.tenantId,
          source: row.source,
          intake: row.intake,
          secret: this.#cipher.decrypt(row.encryptedSecret),
        }
      : null;
    this.#cache.set(key, { origin, expiresAt: Date.now() + this.#ttlMs });
    return origin ?? undefined;
  }

  async list(): Promise<OriginSummary[]> {
    const rows = await this.#store.list();
    return rows.map(row => ({ tenant_id: row.tenantId, source: row.source, intake: row.intake }));
  }

  /**
   * Registers an origin. The secret is returned here and nowhere else — a
   * caller that lets it go has to rotate to get another one.
   */
  async register(
    tenantId: string,
    source: string,
    intake: 'alert' | 'monitor',
    secret?: string,
  ): Promise<{ origin: OriginSummary; secret: string }> {
    const minted = secret ?? generateSecret();
    await this.#store.upsert({
      tenantId,
      source,
      intake,
      encryptedSecret: this.#cipher.encrypt(minted),
    });
    this.#cache.delete(`${tenantId}:${source}`);
    return { origin: { tenant_id: tenantId, source, intake }, secret: minted };
  }

  /**
   * Replaces the secret. The old one stops being accepted as soon as the
   * cache entry it was read from expires, so whoever signs for this origin
   * switches to the new value right away.
   */
  async rotate(
    tenantId: string,
    source: string,
    secret?: string,
  ): Promise<{ origin: OriginSummary; secret: string }> {
    const minted = secret ?? generateSecret();
    const replaced = await this.#store.replaceSecret(
      tenantId,
      source,
      this.#cipher.encrypt(minted),
    );
    if (!replaced) {
      throw createError.NotFound('no origin is registered under this tenant and source');
    }

    const row = await this.#store.find(tenantId, source);
    this.#cache.delete(`${tenantId}:${source}`);
    // The row was just written, so intake is whatever it already carried.
    return {
      origin: { tenant_id: tenantId, source, intake: row?.intake ?? 'alert' },
      secret: minted,
    };
  }
}
