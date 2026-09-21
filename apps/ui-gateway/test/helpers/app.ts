import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.ts';
import type { PrismaClient } from '../../src/generated/prisma/client.ts';
import { SealedJson, SecretCipher } from '../../src/lib/cipher.ts';

type Extend = (app: FastifyInstance) => void;

export async function createTestApp(extend?: Extend): Promise<FastifyInstance> {
  process.env.SOURCE_SECRET_KEY ??= TEST_SECRET_KEY;
  process.env.SESSION_COOKIE_KEY ??= TEST_SECRET_KEY;
  const app = buildApp({ logger: false });
  extend?.(app);
  stubKafka(app);
  stubPrisma(app);
  await app.ready();
  stubIntrospection(app);
  return app;
}

/** The tenants the seeded caller acts for — the groups its token would carry. */
export const TEST_TENANTS = ['locaweb', 'outro-tenant'];

/**
 * Every REST route now asks the identity provider who is calling, and no test
 * reaches one. The stub answers for TEST_BEARER alone, so a test that sends
 * nothing still exercises the 401 path.
 */
export const TEST_BEARER = 'test-access-token';

export function stubIntrospection(app: FastifyInstance): void {
  if (!app.hasDecorator('services')) return;
  app.services.oidc.introspect = async (token: string) =>
    token === TEST_BEARER ? { sub: 'test-user', groups: TEST_TENANTS } : undefined;
  app.services.oidc.revoke = async () => undefined;
  app.services.oidc.refresh = async () => undefined;
  Object.defineProperty(app.services.oidc, 'configured', { get: () => true });
}

/** What an authenticated caller sends; the MCP client sends the same. */
export const authHeaders = { authorization: `Bearer ${TEST_BEARER}` };

/** Cookie + CSRF as the browser would send them after /auth/callback. */
export function sessionHeaders(
  app: FastifyInstance,
  accessToken = TEST_BEARER,
): { cookie: string; 'x-csrf-token': string } {
  const csrf = 'test-csrf-token';
  const sealed = new SealedJson(app.env.SESSION_COOKIE_KEY).seal({
    accessToken,
    refreshToken: 'test-refresh',
    csrf,
  });
  return {
    cookie: `oa_session=${sealed}; oa_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
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
  app.decorate('kafka', {
    publish: async () => undefined,
    publishBatch: async () => undefined,
  });
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
  status: 'active' | 'disabled';
  encryptedSecret: string;
};

function seededSources(): Map<string, SourceRow> {
  const cipher = new SecretCipher(TEST_SECRET_KEY);
  const encryptedSecret = cipher.encrypt(TEST_SECRET);
  const active = 'active' as const;
  return new Map([
    [
      'locaweb:itsm',
      {
        tenantId: 'locaweb',
        name: 'itsm',
        intake: 'alert' as const,
        status: active,
        encryptedSecret,
      },
    ],
    [
      'locaweb:zabbix',
      {
        tenantId: 'locaweb',
        name: 'zabbix',
        intake: 'monitor' as const,
        status: active,
        encryptedSecret,
      },
    ],
  ]);
}

type AnalysisRow = {
  id: string;
  analysis: string;
  tenantId: string | null;
  trigger: 'manual' | 'scheduled' | 'chained';
  parentId: string | null;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  runKeyHash: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  detail: unknown;
  createdAt: Date;
};

type MappingRow = {
  id: number;
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  version: string;
  bindings: unknown;
  mappings: unknown;
  createdAt: Date;
};

type DeadlineRow = {
  id: number;
  tenantId: string;
  deadlines: unknown;
  createdAt: Date;
};

type TargetRow = {
  id: number;
  tenantId: string;
  targets: unknown;
  createdAt: Date;
};

function newestFirst<T extends { id: number; createdAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
}

function copies<T extends { id: number; createdAt: Date }>() {
  const rows: T[] = [];
  let nextId = 1;
  return {
    findFirst(match: (row: T) => boolean): T | null {
      return newestFirst(rows.filter(match))[0] ?? null;
    },
    findMany(match: (row: T) => boolean, take?: number): T[] {
      const matched = newestFirst(rows.filter(match));
      return take === undefined ? matched : matched.slice(0, take);
    },
    create(data: Omit<T, 'id' | 'createdAt'>): T {
      const row = { id: nextId++, createdAt: new Date(), ...data } as T;
      rows.push(row);
      return row;
    },
  };
}

/** Map behind the Prisma calls the services make. */
export function memoryPrisma(): PrismaClient {
  const rows = new Map<string, AnalysisRow>();
  const sources = seededSources();
  const tenants = new Set([...sources.values()].map(row => row.tenantId));
  const sourceKey = (where: { tenantId: string; name: string }) =>
    `${where.tenantId}:${where.name}`;

  const mappings = copies<MappingRow>();
  const deadlines = copies<DeadlineRow>();
  const targets = copies<TargetRow>();

  const apiKeys = new Map<string, { kind: 'scheduler'; hash: string; revokedAt: Date | null }>();

  const client = {
    apiKey: {
      async create({ data }: { data: { kind: 'scheduler'; prefix: string; hash: string } }) {
        apiKeys.set(data.hash, { kind: data.kind, hash: data.hash, revokedAt: null });
        return { id: data.hash, ...data, createdAt: new Date(), revokedAt: null };
      },
      async findUnique({ where }: { where: { hash: string } }) {
        return apiKeys.get(where.hash) ?? null;
      },
      async upsert({
        where,
        create,
      }: {
        where: { hash: string };
        create: { kind: 'scheduler'; prefix: string; hash: string };
        update: object;
      }) {
        if (!apiKeys.has(where.hash)) {
          apiKeys.set(where.hash, { kind: create.kind, hash: create.hash, revokedAt: null });
        }
        return apiKeys.get(where.hash);
      },
    },
    tenant: {
      async upsert({
        where,
        create,
      }: {
        where: { id: string };
        create: { id: string };
        update: object;
      }) {
        tenants.add(where.id);
        return { id: create.id, createdAt: new Date(), updatedAt: new Date() };
      },
    },
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
          runKeyHash: string;
        };
        update: Partial<AnalysisRow>;
      }) {
        const current = rows.get(where.id);
        if (!current) {
          rows.set(where.id, {
            id: create.id,
            analysis: create.analysis ?? 'unknown',
            tenantId: create.tenantId ?? null,
            trigger: create.trigger ?? 'manual',
            parentId: create.parentId ?? null,
            status: create.status,
            runKeyHash: create.runKeyHash,
            startedAt: create.startedAt ?? null,
            finishedAt: create.finishedAt ?? null,
            detail: create.detail ?? null,
            createdAt: new Date(),
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
      async findUnique({ where }: { where: { id?: string; runKeyHash?: string } }) {
        if (where.runKeyHash !== undefined) {
          for (const row of rows.values()) {
            if (row.runKeyHash === where.runKeyHash) return row;
          }
          return null;
        }
        return (where.id !== undefined ? rows.get(where.id) : undefined) ?? null;
      },
      async findMany({
        where,
        take,
      }: {
        where?: {
          trigger?: AnalysisRow['trigger'];
          analysis?: string;
          OR?: { tenantId: string | null }[];
        };
        take?: number;
      }) {
        const matches = [...rows.values()]
          .filter(
            row =>
              (!where?.trigger || row.trigger === where.trigger) &&
              (!where?.analysis || row.analysis === where.analysis) &&
              (!where?.OR || where.OR.some(clause => row.tenantId === clause.tenantId)),
          )
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? matches.slice(0, take) : matches;
      },
    },
    mapping: {
      async findFirst({ where }: { where: { tenantId: string; source: string } }) {
        return mappings.findFirst(
          row => row.tenantId === where.tenantId && row.source === where.source,
        );
      },
      async findMany({
        where,
        take,
      }: {
        where: { tenantId: string; source: string };
        take?: number;
      }) {
        return mappings.findMany(
          row => row.tenantId === where.tenantId && row.source === where.source,
          take,
        );
      },
      async create({ data }: { data: Omit<MappingRow, 'id' | 'createdAt'> }) {
        return mappings.create(data);
      },
    },
    deadline: {
      async findFirst({ where }: { where: { tenantId: string } }) {
        return deadlines.findFirst(row => row.tenantId === where.tenantId);
      },
      async findMany({ where, take }: { where: { tenantId: string }; take?: number }) {
        return deadlines.findMany(row => row.tenantId === where.tenantId, take);
      },
      async create({ data }: { data: Omit<DeadlineRow, 'id' | 'createdAt'> }) {
        return deadlines.create(data);
      },
    },
    target: {
      async findFirst({ where }: { where: { tenantId: string } }) {
        return targets.findFirst(row => row.tenantId === where.tenantId);
      },
      async findMany({ where, take }: { where: { tenantId: string }; take?: number }) {
        return targets.findMany(row => row.tenantId === where.tenantId, take);
      },
      async create({ data }: { data: Omit<TargetRow, 'id' | 'createdAt'> }) {
        return targets.create(data);
      },
    },
    async $transaction<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
      return fn(this as unknown as PrismaClient);
    },
  };

  return client as unknown as PrismaClient;
}
