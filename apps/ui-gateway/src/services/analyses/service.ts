import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import createError from 'http-errors';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { EventPublisher } from '../../plugins/kafka.ts';
import { AnalysisPublish } from './publish.ts';
import type {
  AnalysisRequest,
  AnalysisStatus,
  AnalysisStatusUpdate,
  AnalysisStatusValue,
} from './schema.ts';
import { AnalysisStore } from './store.ts';

export class AnalysesService {
  #store: AnalysisStore;
  #publish: AnalysisPublish;

  constructor(store: PrismaClient, publish: EventPublisher, topics: { ml: string; data: string }) {
    this.#store = new AnalysisStore(store);
    this.#publish = new AnalysisPublish(publish, topics);
  }

  async start(request: AnalysisRequest): Promise<{ id: string }> {
    const id = randomUUID();
    const updateKey = randomBytes(32).toString('base64url');
    await this.#store.enqueue(id, hashUpdateKey(updateKey));
    await this.#publish.send(id, request, updateKey);
    return { id };
  }

  async update(
    id: string,
    patch: AnalysisStatusUpdate,
    updateKey: string,
  ): Promise<AnalysisStatus> {
    const stored = await this.#store.findUpdateKeyHash(id);
    if (!stored || !matchesStoredHash(updateKey, stored)) {
      throw createError.Unauthorized('invalid update key');
    }
    const current = await this.#store.getStatus(id);
    if (!current) throw createError.NotFound('analysis not found');
    if (!allowsTransition(current.status, patch.status)) {
      throw createError.Conflict('status cannot move backwards');
    }
    await this.#store.recordStatus({ id, ...patch });
    return this.getStatus(id);
  }

  async getStatus(id: string): Promise<AnalysisStatus> {
    const status = await this.#store.getStatus(id);
    if (!status) throw createError.NotFound('analysis not found');
    return status;
  }
}

function hashUpdateKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

const STATUS_RANK: Record<AnalysisStatusValue, number> = {
  pending: 0,
  running: 1,
  succeeded: 2,
  failed: 2,
};

function allowsTransition(from: AnalysisStatusValue, to: AnalysisStatusValue): boolean {
  return to === from || STATUS_RANK[to] > STATUS_RANK[from];
}

function matchesStoredHash(key: string, storedHex: string): boolean {
  const presented = Buffer.from(hashUpdateKey(key), 'hex');
  const stored = Buffer.from(storedHex, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
