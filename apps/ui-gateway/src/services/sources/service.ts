import createError from 'http-errors';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { generateSecret, type SecretCipher } from '../../lib/cipher.ts';
import { SourceStore } from './store.ts';

export type SourceStatus = 'active' | 'disabled';

export interface AcceptedSource {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  status: SourceStatus;
  /** Decrypted for the signature check, never for a response body. */
  secret: string;
}

/** What a caller sees: the same record, minus the secret. */
export interface SourceSummary {
  tenant_id: string;
  source: string;
  intake: 'alert' | 'monitor';
  status: SourceStatus;
}

interface CacheEntry {
  source: AcceptedSource | null;
  expiresAt: number;
}

/**
 * The systems each tenant sends events from. Read per request rather than
 * replayed at boot, so a newly registered source starts working on its own
 * and a database that is down fails the request instead of the pod.
 *
 * The short cache is what keeps a replay — 122k events over one source — from
 * becoming 122k queries. It also caches the misses, so an address nobody
 * configured cannot be used to hammer the database.
 */
export class SourcesService {
  #store: SourceStore;
  #cipher: SecretCipher;
  #ttlMs: number;
  #cache = new Map<string, CacheEntry>();

  constructor(prisma: PrismaClient, cipher: SecretCipher, ttlMs: number) {
    this.#store = new SourceStore(prisma);
    this.#cipher = cipher;
    this.#ttlMs = ttlMs;
  }

  /**
   * Resolves whether the address exists at all — a disabled source is still
   * returned, so the caller can tell "turned off" from "never existed" and
   * answer accordingly.
   */
  async find(tenantId: string, source: string): Promise<AcceptedSource | undefined> {
    const key = `${tenantId}:${source}`;
    const cached = this.#cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.source ?? undefined;

    const row = await this.#store.find(tenantId, source);
    const accepted = row
      ? {
          tenantId: row.tenantId,
          source: row.name,
          intake: row.intake,
          status: row.status,
          secret: this.#cipher.decrypt(row.encryptedSecret),
        }
      : null;
    this.#cache.set(key, { source: accepted, expiresAt: Date.now() + this.#ttlMs });
    return accepted ?? undefined;
  }

  /** Always scoped to one tenant: no caller has business seeing another's. */
  async listByTenant(tenantId: string): Promise<SourceSummary[]> {
    const rows = await this.#store.listByTenant(tenantId);
    return rows.map(row => summary(row.tenantId, row.name, row.intake, row.status));
  }

  /**
   * Registers a source. The secret is returned here and nowhere else — a
   * caller that lets it go has to rotate to get another one.
   */
  async register(
    tenantId: string,
    source: string,
    intake: 'alert' | 'monitor',
    secret?: string,
  ): Promise<{ source: SourceSummary; secret: string }> {
    const minted = secret ?? generateSecret();
    // Re-registering keeps whatever status the source had: turning one back
    // on is an explicit call, never a side effect of rewriting its secret.
    const current = await this.#store.find(tenantId, source);
    const status = current?.status ?? 'active';
    await this.#store.upsert({
      tenantId,
      name: source,
      intake,
      status,
      encryptedSecret: this.#cipher.encrypt(minted),
    });
    this.#cache.delete(`${tenantId}:${source}`);
    return { source: summary(tenantId, source, intake, status), secret: minted };
  }

  /**
   * Replaces the secret. The old one stops being accepted as soon as the
   * cache entry it was read from expires, so whoever signs for this source
   * switches to the new value right away.
   */
  async rotate(
    tenantId: string,
    source: string,
    secret?: string,
  ): Promise<{ source: SourceSummary; secret: string }> {
    const minted = secret ?? generateSecret();
    const replaced = await this.#store.replaceSecret(
      tenantId,
      source,
      this.#cipher.encrypt(minted),
    );
    if (!replaced) throw notFound();

    const row = await this.#store.find(tenantId, source);
    this.#cache.delete(`${tenantId}:${source}`);
    if (!row) throw notFound();
    return { source: summary(tenantId, source, row.intake, row.status), secret: minted };
  }

  /**
   * Turns a source off or back on. Disabling keeps the record and the
   * secret — it stops being answered, and enabling it again needs no
   * re-registration.
   */
  async setStatus(tenantId: string, source: string, status: SourceStatus): Promise<SourceSummary> {
    const changed = await this.#store.setStatus(tenantId, source, status);
    if (!changed) throw notFound();

    const row = await this.#store.find(tenantId, source);
    this.#cache.delete(`${tenantId}:${source}`);
    if (!row) throw notFound();
    return summary(tenantId, source, row.intake, row.status);
  }
}

function summary(
  tenantId: string,
  source: string,
  intake: 'alert' | 'monitor',
  status: SourceStatus,
): SourceSummary {
  return { tenant_id: tenantId, source, intake, status };
}

function notFound() {
  return createError.NotFound('no source is registered under this tenant and name');
}
