import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { InputJsonValue } from '../../generated/prisma/internal/prismaNamespace.ts';
import { type AnalysisStatus, type AnalysisTrigger, analysisStatusSchema } from './schema.ts';

interface QueuedAnalysis {
  analysis: string;
  tenantId?: string;
  trigger: AnalysisTrigger;
  parentId?: string;
}

export interface AnalysisListFilter {
  trigger?: AnalysisTrigger;
  analysis?: string;
  tenantId?: string;
  limit: number;
}

export class AnalysisStore {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async enqueue(id: string, runKeyHash: string, origin: QueuedAnalysis): Promise<void> {
    await this.#prisma.analysis.upsert({
      where: { id },
      create: {
        id,
        status: 'pending',
        runKeyHash,
        analysis: origin.analysis,
        tenantId: origin.tenantId,
        trigger: origin.trigger,
        parentId: origin.parentId,
      },
      update: {},
    });
  }

  async findRunKeyHash(id: string): Promise<string | undefined> {
    const row = await this.#prisma.analysis.findUnique({
      where: { id },
      select: { runKeyHash: true },
    });
    return row?.runKeyHash;
  }

  /** The chained POST presents the key itself, never the parent's id. */
  async findByRunKeyHash(
    runKeyHash: string,
  ): Promise<{ id: string; analysis: string } | undefined> {
    const row = await this.#prisma.analysis.findUnique({
      where: { runKeyHash },
      select: { id: true, analysis: true },
    });
    return row ?? undefined;
  }

  async recordStatus(status: AnalysisStatus): Promise<void> {
    await this.#prisma.analysis.update({
      where: { id: status.id },
      data: {
        status: status.status,
        startedAt: status.started_at,
        finishedAt: status.finished_at,
        detail: status.detail as InputJsonValue | undefined,
      },
    });
  }

  async getStatus(id: string): Promise<AnalysisStatus | undefined> {
    const row = await this.#prisma.analysis.findUnique({ where: { id } });
    if (!row) return undefined;
    return toStatus(row);
  }

  async list(filter: AnalysisListFilter): Promise<AnalysisStatus[]> {
    const rows = await this.#prisma.analysis.findMany({
      where: {
        ...(filter.trigger ? { trigger: filter.trigger } : {}),
        ...(filter.analysis ? { analysis: filter.analysis } : {}),
        // A data analysis rebuilds every mart at once and so carries no
        // tenant. A tenant's listing includes those rows because they are the
        // same runs GET /analyses/{id} already answers for to any caller —
        // filtering on tenantId alone would hide a run the caller started.
        ...(filter.tenantId ? { OR: [{ tenantId: filter.tenantId }, { tenantId: null }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
    });
    return rows.map(toStatus);
  }
}

type AnalysisRow = Awaited<ReturnType<PrismaClient['analysis']['findUniqueOrThrow']>>;

function toStatus(row: AnalysisRow): AnalysisStatus {
  const detail = analysisStatusSchema.shape.detail.safeParse(row.detail);
  return {
    id: row.id,
    analysis: row.analysis,
    tenant_id: row.tenantId ?? undefined,
    trigger: row.trigger,
    parent_id: row.parentId ?? undefined,
    status: row.status,
    started_at: row.startedAt ?? undefined,
    finished_at: row.finishedAt ?? undefined,
    detail: detail.success ? detail.data : undefined,
  };
}
