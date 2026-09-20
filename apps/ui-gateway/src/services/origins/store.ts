import type { PrismaClient } from '../../generated/prisma/client.ts';

export interface OriginRow {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  encryptedSecret: string;
}

export class OriginStore {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async find(tenantId: string, source: string): Promise<OriginRow | undefined> {
    const row = await this.#prisma.origin.findUnique({
      where: { tenantId_source: { tenantId, source } },
    });
    return row ?? undefined;
  }

  async list(): Promise<OriginRow[]> {
    return this.#prisma.origin.findMany({ orderBy: [{ tenantId: 'asc' }, { source: 'asc' }] });
  }

  async upsert(row: OriginRow): Promise<void> {
    const { tenantId, source, intake, encryptedSecret } = row;
    await this.#prisma.origin.upsert({
      where: { tenantId_source: { tenantId, source } },
      create: { tenantId, source, intake, encryptedSecret },
      update: { intake, encryptedSecret },
    });
  }

  async replaceSecret(tenantId: string, source: string, encryptedSecret: string): Promise<boolean> {
    const { count } = await this.#prisma.origin.updateMany({
      where: { tenantId, source },
      data: { encryptedSecret },
    });
    return count > 0;
  }
}
