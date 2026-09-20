import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { PrismaClient } from '../../src/generated/prisma/client.ts';
import { SecretCipher } from '../../src/services/sources/cipher.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  process.env.SOURCE_SECRET_KEY ??= TEST_SECRET_KEY;
  const app = buildApp({ logger: false });
  extend?.(app);
  stubKafka(app);
  stubPrisma(app);
  await app.ready();
  return app;
}

/** The secret the seeded sources sign with — what a test signs its bodies with. */
export const TEST_SECRET = 'itsm-shared-secret';

/** A key of the right size, so tests never reach a Vault. */
export const TEST_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * No test reaches a broker: unless the test provided its own publisher, the app
 * gets one that swallows the event.
 */
export function stubKafka(app: FastifyInstance): void {
  if (app.hasDecorator('kafka')) return;
  app.decorate('kafka', { publish: async () => undefined });
}

/**
 * No test reaches Postgres. The ITSM origin the loop has always run on is
 * seeded, so a webhook test has an address that resolves.
 */
export function stubPrisma(app: FastifyInstance): void {
  if (app.hasDecorator('prisma')) return;
  app.decorate('prisma', memoryPrisma());
}

type SourceRow = {
  tenantId: string;
  name: string;
  intake: 'alert' | 'monitor';
  encryptedSecret: string;
};

function seededSources(): Map<string, SourceRow> {
  const cipher = new SecretCipher(TEST_SECRET_KEY);
  const encryptedSecret = cipher.encrypt(TEST_SECRET);
  return new Map([
    ['locaweb:itsm', { tenantId: 'locaweb', name: 'itsm', intake: 'alert', encryptedSecret }],
    ['locaweb:zabbix', { tenantId: 'locaweb', name: 'zabbix', intake: 'monitor', encryptedSecret }],
  ]);
}

type AnalysisRow = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  updateKeyHash: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  detail: unknown;
};

/** Map behind the Prisma calls the services make. */
export function memoryPrisma(): PrismaClient {
  const rows = new Map<string, AnalysisRow>();
  const sources = seededSources();
  const sourceKey = (where: { tenantId: string; name: string }) =>
    `${where.tenantId}:${where.name}`;

  return {
    source: {
      async findUnique({ where }: { where: { tenantId_name: SourceRow } }) {
        return sources.get(sourceKey(where.tenantId_name)) ?? null;
      },
      async findMany({ where }: { where?: { tenantId?: string } } = {}) {
        const all = [...sources.values()];
        return where?.tenantId ? all.filter(row => row.tenantId === where.tenantId) : all;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { tenantId_name: { tenantId: string; name: string } };
        create: SourceRow;
        update: Partial<SourceRow>;
      }) {
        const key = sourceKey(where.tenantId_name);
        const current = sources.get(key);
        sources.set(key, current ? { ...current, ...update } : create);
        return sources.get(key);
      },
      async updateMany({
        where,
        data,
      }: {
        where: { tenantId: string; name: string };
        data: Partial<SourceRow>;
      }) {
        const key = sourceKey(where);
        const current = sources.get(key);
        if (!current) return { count: 0 };
        sources.set(key, { ...current, ...data });
        return { count: 1 };
      },
    },
    analysis: {
      async upsert({
        where,
        create,
        update,
      }: {
        where: { id: string };
        create: Partial<AnalysisRow> & {
          id: string;
          status: AnalysisRow['status'];
          updateKeyHash: string;
        };
        update: Partial<AnalysisRow>;
      }) {
        const current = rows.get(where.id);
        if (!current) {
          rows.set(where.id, {
            id: create.id,
            status: create.status,
            updateKeyHash: create.updateKeyHash,
            startedAt: create.startedAt ?? null,
            finishedAt: create.finishedAt ?? null,
            detail: create.detail ?? null,
          });
        } else {
          rows.set(where.id, { ...current, ...update });
        }
        return rows.get(where.id);
      },
      async update({ where, data }: { where: { id: string }; data: Partial<AnalysisRow> }) {
        const current = rows.get(where.id);
        if (!current) throw new Error('not found');
        rows.set(where.id, { ...current, ...data });
        return rows.get(where.id);
      },
      async findUnique({ where }: { where: { id: string } }) {
        return rows.get(where.id) ?? null;
      },
    },
  } as unknown as PrismaClient;
}
