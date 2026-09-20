import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { InputJsonValue } from '../../generated/prisma/internal/prismaNamespace.ts';
import type { DeadlineSet, Mapping, TargetSet } from './schema.ts';

/** How many published copies GET /history returns. Older rows stay stored. */
export const HISTORY_LIMIT = 10;

export interface Stored<T> {
  id: number;
  createdAt: Date;
  document: T;
}

/** Published mappings, deadline sets and target sets. */
export class RuleStore {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async latestMapping(tenantId: string, source: string): Promise<Stored<Mapping> | undefined> {
    const row = await this.#prisma.mapping.findFirst({
      where: { tenantId, source },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? { id: row.id, createdAt: row.createdAt, document: toMapping(row) } : undefined;
  }

  async listMappings(tenantId: string, source: string): Promise<Stored<Mapping>[]> {
    const rows = await this.#prisma.mapping.findMany({
      where: { tenantId, source },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    return rows.map(row => ({ id: row.id, createdAt: row.createdAt, document: toMapping(row) }));
  }

  async hasSource(tenantId: string, source: string): Promise<boolean> {
    const row = await this.#prisma.source.findUnique({
      where: { tenantId_name: { tenantId, name: source } },
    });
    return row !== null;
  }

  async appendMapping(tenantId: string, source: string, mapping: Mapping): Promise<void> {
    await this.#prisma.mapping.create({
      data: {
        tenantId,
        source,
        intake: mapping.intake,
        version: mapping.version,
        bindings: mapping.bindings as InputJsonValue,
        mappings: mapping.mappings as InputJsonValue,
      },
    });
  }

  async latestDeadlines(tenantId: string): Promise<Stored<DeadlineSet> | undefined> {
    const row = await this.#prisma.deadline.findFirst({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? { id: row.id, createdAt: row.createdAt, document: toDeadlines(row) } : undefined;
  }

  async listDeadlines(tenantId: string): Promise<Stored<DeadlineSet>[]> {
    const rows = await this.#prisma.deadline.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    return rows.map(row => ({ id: row.id, createdAt: row.createdAt, document: toDeadlines(row) }));
  }

  async appendDeadlines(tenantId: string, deadlines: DeadlineSet): Promise<void> {
    await this.#prisma.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId },
      update: {},
    });
    await this.#prisma.deadline.create({
      data: { tenantId, deadlines: deadlines.deadlines as InputJsonValue },
    });
  }

  async latestTargets(tenantId: string): Promise<Stored<TargetSet> | undefined> {
    const row = await this.#prisma.target.findFirst({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return row ? { id: row.id, createdAt: row.createdAt, document: toTargets(row) } : undefined;
  }

  async listTargets(tenantId: string): Promise<Stored<TargetSet>[]> {
    const rows = await this.#prisma.target.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_LIMIT,
    });
    return rows.map(row => ({ id: row.id, createdAt: row.createdAt, document: toTargets(row) }));
  }

  async appendTargets(tenantId: string, targets: TargetSet): Promise<void> {
    await this.#prisma.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId },
      update: {},
    });
    await this.#prisma.target.create({
      data: { tenantId, targets: targets.targets as InputJsonValue },
    });
  }
}

function toMapping(row: {
  intake: Mapping['intake'];
  version: string;
  bindings: unknown;
  mappings: unknown;
}): Mapping {
  return {
    intake: row.intake,
    version: row.version,
    bindings: row.bindings as Mapping['bindings'],
    mappings: row.mappings as Mapping['mappings'],
  };
}

function toDeadlines(row: { deadlines: unknown }): DeadlineSet {
  return { deadlines: row.deadlines as DeadlineSet['deadlines'] };
}

function toTargets(row: { targets: unknown }): TargetSet {
  return { targets: row.targets as TargetSet['targets'] };
}
