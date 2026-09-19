import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { InputJsonValue } from '../../generated/prisma/internal/prismaNamespace.ts';
import { type AnalysisStatus, analysisStatusSchema } from './schema.ts';

export class AnalysisStore {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async enqueue(id: string, updateKeyHash: string): Promise<void> {
    await this.#prisma.analysis.upsert({
      where: { id },
      create: { id, status: 'pending', updateKeyHash },
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
    const detail = analysisStatusSchema.shape.detail.safeParse(row.detail);
    return {
      id: row.id,
      status: row.status,
      started_at: row.startedAt ?? undefined,
      finished_at: row.finishedAt ?? undefined,
      detail: detail.success ? detail.data : undefined,
    };
  }
}
