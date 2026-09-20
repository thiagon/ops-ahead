import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { InputJsonValue } from '../../generated/prisma/internal/prismaNamespace.ts';
import { type AnalysisStatus, type AnalysisTrigger, analysisStatusSchema } from './schema.ts';

export interface AnalysisOrigin {
  analysis: string;
  trigger: AnalysisTrigger;
  parentId?: string;
}

export interface AnalysisListFilter {
  trigger?: AnalysisTrigger;
  analysis?: string;
  limit: number;
}

export class AnalysisStore {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async enqueue(id: string, updateKeyHash: string, origin: AnalysisOrigin): Promise<void> {
    await this.#prisma.analysis.upsert({
      where: { id },
      create: {
        id,
        status: 'pending',
        updateKeyHash,
        analysis: origin.analysis,
        trigger: origin.trigger,
        parentId: origin.parentId,
      },
      update: {},
    });
  }

  async findUpdateKeyHash(id: string): Promise<string | undefined> {
    const row = await this.#prisma.analysis.findUnique({
      where: { id },
      select: { updateKeyHash: true },
    });
    return row?.updateKeyHash;
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
    trigger: row.trigger,
    parent_id: row.parentId ?? undefined,
    status: row.status,
    started_at: row.startedAt ?? undefined,
    finished_at: row.finishedAt ?? undefined,
    detail: detail.success ? detail.data : undefined,
  };
}
