import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { PrismaClient } from '../../src/generated/prisma/client.ts';
import { SecretCipher } from '../../src/services/origins/cipher.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  process.env.ORIGIN_SECRET_KEY ??= TEST_SECRET_KEY;
  const app = buildApp({ logger: false });
  extend?.(app);
  stubKafka(app);
  stubPrisma(app);
  await app.ready();
  return app;
}

/** The secret TEST_ORIGIN signs with — what a test signs its bodies with. */
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

type OriginRow = {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  encryptedSecret: string;
};

function seededOrigins(): Map<string, OriginRow> {
  const cipher = new SecretCipher(TEST_SECRET_KEY);
  const encryptedSecret = cipher.encrypt(TEST_SECRET);
  return new Map([
    ['locaweb:itsm', { tenantId: 'locaweb', source: 'itsm', intake: 'alert', encryptedSecret }],
    [
      'locaweb:zabbix',
      { tenantId: 'locaweb', source: 'zabbix', intake: 'monitor', encryptedSecret },
    ],
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
  const origins = seededOrigins();
  const originKey = (where: { tenantId: string; source: string }) =>
    `${where.tenantId}:${where.source}`;

  return {
    origin: {
      async findUnique({ where }: { where: { tenantId_source: OriginRow } }) {
        return origins.get(originKey(where.tenantId_source)) ?? null;
      },
      async findMany() {
        return [...origins.values()];
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { tenantId_source: { tenantId: string; source: string } };
        create: OriginRow;
        update: Partial<OriginRow>;
      }) {
        const key = originKey(where.tenantId_source);
        const current = origins.get(key);
        origins.set(key, current ? { ...current, ...update } : create);
        return origins.get(key);
      },
      async updateMany({
        where,
        data,
      }: {
        where: { tenantId: string; source: string };
        data: Partial<OriginRow>;
      }) {
        const key = originKey(where);
        const current = origins.get(key);
        if (!current) return { count: 0 };
        origins.set(key, { ...current, ...data });
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
