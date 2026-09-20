import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { PrismaClient } from '../../src/generated/prisma/client.ts';
import { OriginRegistry } from '../../src/plugins/origins.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  const app = buildApp({ logger: false });
  extend?.(app);
  stubKafka(app);
  stubOrigins(app);
  stubPrisma(app);
  await app.ready();
  return app;
}

/** The secret TEST_ORIGIN signs with — what a test signs its bodies with. */
export const TEST_SECRET = 'itsm-shared-secret';

/**
 * The origin the ITSM loop has always run on. A test that needs another
 * origin decorates `origins` itself before this fills in.
 */
export const TEST_ORIGIN = {
  tenantId: 'locaweb',
  source: 'itsm',
  intake: 'alert' as const,
  secret: TEST_SECRET,
};

/** No test reads ORIGINS out of the environment. */
export function stubOrigins(app: FastifyInstance): void {
  if (app.hasDecorator('origins')) return;
  app.decorate(
    'origins',
    new OriginRegistry({
      'locaweb:itsm': { intake: 'alert', secret: TEST_SECRET },
      'locaweb:zabbix': { intake: 'monitor', secret: TEST_SECRET },
    }),
  );
}

/**
 * No test reaches a broker: unless the test provided its own publisher, the app
 * gets one that swallows the event.
 */
export function stubKafka(app: FastifyInstance): void {
  if (app.hasDecorator('kafka')) return;
  app.decorate('kafka', { publish: async () => undefined });
}

/** No test reaches Postgres. */
export function stubPrisma(app: FastifyInstance): void {
  if (app.hasDecorator('prisma')) return;
  app.decorate('prisma', memoryPrisma());
}

type AnalysisRow = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  updateKeyHash: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  detail: unknown;
};

/** Map behind the Prisma calls the service makes. */
export function memoryPrisma(): PrismaClient {
  const rows = new Map<string, AnalysisRow>();

  return {
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
