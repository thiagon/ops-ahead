import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import createError from 'http-errors';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { EventPublisher } from '../../lib/kafka.ts';
import { AnalysisPublish } from './publish.ts';
import type {
  AnalysisOrigin,
  AnalysisRequest,
  AnalysisStatus,
  AnalysisStatusUpdate,
  AnalysisStatusValue,
} from './schema.ts';
import { type AnalysisListFilter, AnalysisStore } from './store.ts';

export class AnalysesService {
  #store: AnalysisStore;
  #publish: AnalysisPublish;

  constructor(store: PrismaClient, publish: EventPublisher, topics: { ml: string; data: string }) {
    this.#store = new AnalysisStore(store);
    this.#publish = new AnalysisPublish(publish, topics);
  }

  async start(request: AnalysisRequest, origin: AnalysisOrigin): Promise<{ id: string }> {
    const parentId =
      origin.trigger === 'chained' ? await this.#resolveParent(origin.parentRunKey) : undefined;

    const id = randomUUID();
    const runKey = randomBytes(32).toString('base64url');
    await this.#store.enqueue(id, hashRunKey(runKey), {
      analysis: request.analysis,
      tenantId: 'tenant_id' in request ? request.tenant_id : undefined,
      trigger: origin.trigger,
      parentId,
    });
    try {
      await this.#publish.send(id, request, runKey);
    } catch {
      throw createError.BadGateway('could not publish the event to the bus');
    }
    return { id };
  }

  /**
   * A run key only chains off a full_pipeline: chaining from a training would
   * let one model's run mint another, which no step of the daily chain does.
   */
  async #resolveParent(runKey: string): Promise<string> {
    const parent = await this.#store.findByRunKeyHash(hashRunKey(runKey));
    if (!parent) throw createError.Unauthorized('invalid run key');
    if (parent.analysis !== 'full_pipeline') {
      throw createError.Conflict('only a full_pipeline run can chain another analysis');
    }
    return parent.id;
  }

  async update(id: string, patch: AnalysisStatusUpdate, runKey: string): Promise<AnalysisStatus> {
    const stored = await this.#store.findRunKeyHash(id);
    if (!stored || !matchesStoredHash(runKey, stored)) {
      throw createError.Unauthorized('invalid run key');
    }
    const current = await this.#load(id);
    if (!allowsTransition(current.status, patch.status)) {
      throw createError.Conflict('status cannot move backwards');
    }
    await this.#store.recordStatus({ id, ...patch });
    return this.#load(id);
  }

  async getStatus(id: string, tenants?: readonly string[]): Promise<AnalysisStatus> {
    const status = await this.#load(id);
    if (status.tenant_id && tenants && !tenants.includes(status.tenant_id)) {
      throw createError.Forbidden('this caller does not act for that tenant');
    }
    return status;
  }

  async #load(id: string): Promise<AnalysisStatus> {
    const status = await this.#store.getStatus(id);
    if (!status) throw createError.NotFound('analysis not found');
    return status;
  }

  async list(filter: AnalysisListFilter): Promise<AnalysisStatus[]> {
    return this.#store.list(filter);
  }
}

function hashRunKey(key: string): string {
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
  const presented = Buffer.from(hashRunKey(key), 'hex');
  const stored = Buffer.from(storedHex, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
