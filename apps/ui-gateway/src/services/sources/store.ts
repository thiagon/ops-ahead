import type { PrismaClient } from '#generated/prisma/client.ts';

export interface SourceRow {
  tenantId: string;
  name: string;
  intake: 'alert' | 'monitor';
  status: 'active' | 'disabled';
  encryptedSecret: string;
}

export class SourceStore {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async find(tenantId: string, name: string): Promise<SourceRow | undefined> {
    const row = await this.#prisma.source.findUnique({
      where: { tenantId_name: { tenantId, name } },
    });
    return row ?? undefined;
  }

  async listByTenant(tenantId: string): Promise<SourceRow[]> {
    return this.#prisma.source.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async upsert(row: SourceRow): Promise<void> {
    const { tenantId, name, intake, status, encryptedSecret } = row;
    await this.#prisma.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId },
      update: {},
    });
    await this.#prisma.source.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name, intake, status, encryptedSecret },
      update: { intake, status, encryptedSecret },
    });
  }

  async setStatus(tenantId: string, name: string, status: 'active' | 'disabled'): Promise<boolean> {
    const { count } = await this.#prisma.source.updateMany({
      where: { tenantId, name },
      data: { status },
    });
    return count > 0;
  }

  async replaceSecret(tenantId: string, name: string, encryptedSecret: string): Promise<boolean> {
    const { count } = await this.#prisma.source.updateMany({
      where: { tenantId, name },
      data: { encryptedSecret },
    });
    return count > 0;
  }
}
