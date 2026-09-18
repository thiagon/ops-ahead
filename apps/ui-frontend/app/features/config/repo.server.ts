import { PrismaClient } from '@prisma/client';
import { getConfig } from '~/config.server.ts';
import type {
  ConfigDomain,
  Deadline,
  FieldBinding,
  Intake,
  KpiTarget,
  MappingEntry,
  MappingField,
} from './types.ts';

/**
 * The configuration registry, read and written straight from the loaders — the
 * same way clickhouse.server.ts serves every other screen. This database
 * belongs to the frontend: nothing else reads or writes it.
 */

let cached: PrismaClient | undefined;

/**
 * `@prisma/client` resolves to the Node build and CONFIG_DATABASE_URL carries
 * the credentials, so both stay in the server bundle — what the `.server.ts`
 * suffix guarantees.
 */
function db(): PrismaClient {
  cached ??= new PrismaClient({
    datasources: { db: { url: getConfig().CONFIG_DATABASE_URL } },
  });
  return cached;
}

/** An integration as the screens read it — the origin plus what it maps. */
export interface Integration {
  source: string;
  intake: Intake;
  envelopeVersion: string;
  secretCreatedAt: string | null;
  enabled: boolean;
  dictionaryVersion: string | null;
  dictionaryStatus: 'published' | 'draft' | null;
  bindings: FieldBinding[];
  mappings: Partial<Record<MappingField, MappingEntry[]>>;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

function tenant(): string {
  return getConfig().TENANT_ID;
}

/** Until the screens have login, the history is real and its authorship is not. */
const AUTHOR = 'anonymous';

type OriginWithRelations = {
  source: string;
  intake: string;
  envelopeVersion: string;
  secretCreatedAt: Date | null;
  enabled: boolean;
  dictionary: { version: string; status: string } | null;
  bindings: { field: string; path: string | null }[];
  mappings: { id: string; mappingField: string; fromValue: string; toValue: string }[];
};

function compose(origin: OriginWithRelations): Integration {
  return {
    source: origin.source,
    intake: origin.intake as Intake,
    envelopeVersion: origin.envelopeVersion,
    secretCreatedAt: origin.secretCreatedAt?.toISOString() ?? null,
    enabled: origin.enabled,
    dictionaryVersion: origin.dictionary?.version ?? null,
    dictionaryStatus: (origin.dictionary?.status as 'published' | 'draft') ?? null,
    bindings: origin.bindings.map(({ field, path }) => ({ field, path })),
    mappings: origin.mappings.reduce<Integration['mappings']>((acc, mapping) => {
      const field = mapping.mappingField as MappingField;
      const entries = acc[field] ?? [];
      entries.push({ id: mapping.id, from: mapping.fromValue, to: mapping.toValue });
      acc[field] = entries;
      return acc;
    }, {}),
  };
}

/** Every read of an origin brings what it maps, so one integration is one read. */
function withRelations() {
  return {
    dictionary: true,
    bindings: { orderBy: { field: 'asc' as const } },
    mappings: { orderBy: [{ mappingField: 'asc' as const }, { fromValue: 'asc' as const }] },
  };
}

export async function listIntegrations(): Promise<Integration[]> {
  const origins = await db().origin.findMany({
    where: { tenantId: tenant() },
    include: withRelations(),
    orderBy: { source: 'asc' },
  });
  return origins.map(compose);
}

export async function getIntegration(source: string): Promise<Integration> {
  const origin = await db().origin.findUnique({
    where: { tenantId_source: { tenantId: tenant(), source } },
    include: withRelations(),
  });
  if (!origin) throw new NotFoundError(`Integração ${source} não existe.`);
  return compose(origin);
}

export async function listDeadlines(): Promise<Deadline[]> {
  const rows = await db().deadline.findMany({
    where: { tenantId: tenant() },
    orderBy: { severity: 'asc' },
  });
  return rows.map(row => ({ severity: row.severity, deadlineSeconds: row.deadlineSeconds }));
}

export async function listKpiTargets(): Promise<KpiTarget[]> {
  const rows = await db().kpiTarget.findMany({
    where: { tenantId: tenant() },
    orderBy: [{ kpiGroup: 'asc' }, { achievementPct: 'desc' }],
  });
  return rows.map(row => ({
    kpiGroup: row.kpiGroup,
    maxBreaches: row.maxBreaches,
    achievementPct: Number(row.achievementPct),
  }));
}

export interface Revision {
  id: string;
  domain: ConfigDomain;
  summary: string;
  author: string;
  at: string;
  /** Whether there is a prior state to restore — a creation replaced nothing. */
  revertible: boolean;
}

export async function listRevisions(): Promise<Revision[]> {
  const rows = await db().revision.findMany({
    where: { tenantId: tenant() },
    orderBy: { at: 'desc' },
    take: 50,
  });
  return rows.map(row => ({
    id: row.id,
    domain: row.domain as ConfigDomain,
    summary: row.summary,
    author: row.author,
    at: row.at.toISOString(),
    revertible: row.payload !== null && row.domain !== 'dictionary',
  }));
}

// ─── writes ──────────────────────────────────────────────────────────────────

/**
 * Append-only. `previous` is the state as it stood *before* the change —
 * restoring it is what a rollback does, so recording the new state would
 * revert to itself. A change with no prior state records none, and the screen
 * says so rather than offering a revert that does nothing.
 */
async function recordRevision(
  domain: ConfigDomain,
  configKey: string,
  summary: string,
  previous: unknown,
): Promise<void> {
  await db().revision.create({
    data: {
      id: crypto.randomUUID(),
      tenantId: tenant(),
      domain,
      configKey,
      summary,
      author: AUTHOR,
      payload: (previous ?? undefined) as never,
    },
  });
}

/**
 * The origin's signing key. Shown once and never stored — what carries it to
 * the gateway is outside these screens for now, so rotating here changes the
 * date on record, not what the gateway accepts.
 */
export function generateSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export async function createIntegration(input: {
  source: string;
  intake: Intake;
  envelopeVersion: string;
}): Promise<{ integration: Integration; secret: string }> {
  const tenantId = tenant();
  const existing = await db().origin.findUnique({
    where: { tenantId_source: { tenantId, source: input.source } },
  });
  if (existing) throw new ConflictError(`Já existe uma integração chamada ${input.source}.`);

  await db().origin.create({
    data: {
      tenantId,
      source: input.source,
      intake: input.intake,
      envelopeVersion: input.envelopeVersion,
      enabled: true,
      secretCreatedAt: new Date(),
      dictionary: { create: { version: 'v1', status: 'draft' } },
    },
  });

  await recordRevision('origin', input.source, `Integração ${input.source} criada`, null);

  return { integration: await getIntegration(input.source), secret: generateSecret() };
}

export async function rotateSecret(source: string): Promise<string> {
  await getIntegration(source);

  await db().origin.update({
    where: { tenantId_source: { tenantId: tenant(), source } },
    data: { secretCreatedAt: new Date() },
  });
  await recordRevision('origin', source, `Chave de ${source} rotacionada`, null);

  return generateSecret();
}

export async function updateBindings(
  source: string,
  bindings: readonly FieldBinding[],
): Promise<Integration> {
  const previous = await getIntegration(source);
  const tenantId = tenant();

  await db().$transaction([
    db().fieldBinding.deleteMany({ where: { tenantId, source } }),
    db().fieldBinding.createMany({
      data: bindings.map(binding => ({
        tenantId,
        source,
        field: binding.field,
        path: binding.path,
      })),
    }),
    // The screen's "Publicar" is this write — draft stays until the customer
    // commits the field paths (and whatever mappings they already added).
    db().dictionaryVersion.upsert({
      where: { tenantId_source: { tenantId, source } },
      update: { status: 'published' },
      create: { tenantId, source, version: 'v1', status: 'published' },
    }),
  ]);

  await recordRevision('origin', source, `Campos de ${source} atualizados`, previous.bindings);
  return await getIntegration(source);
}

export async function upsertMapping(
  source: string,
  input: { field: MappingField; from: string; to: string },
): Promise<Integration> {
  await getIntegration(source);
  const tenantId = tenant();

  await db().mapping.upsert({
    where: {
      tenantId_source_mappingField_fromValue: {
        tenantId,
        source,
        mappingField: input.field,
        fromValue: input.from,
      },
    },
    update: { toValue: input.to },
    create: {
      id: crypto.randomUUID(),
      tenantId,
      source,
      mappingField: input.field,
      fromValue: input.from,
      toValue: input.to,
    },
  });

  await recordRevision('dictionary', source, `${input.from} → ${input.to} em ${input.field}`, null);
  return await getIntegration(source);
}

export async function removeMapping(source: string, mappingId: string): Promise<Integration> {
  const entry = await db().mapping.findFirst({
    where: { id: mappingId, tenantId: tenant(), source },
  });
  if (!entry) throw new NotFoundError('Este valor já não está mapeado.');

  await db().mapping.delete({ where: { id: mappingId } });
  await recordRevision(
    'dictionary',
    source,
    `${entry.fromValue} removido de ${entry.mappingField}`,
    { field: entry.mappingField, from: entry.fromValue, to: entry.toValue },
  );
  return await getIntegration(source);
}

export async function replaceDeadlines(items: readonly Deadline[]): Promise<Deadline[]> {
  const previous = await listDeadlines();
  const tenantId = tenant();

  await db().$transaction([
    db().deadline.deleteMany({ where: { tenantId } }),
    db().deadline.createMany({
      data: items.map(item => ({
        tenantId,
        severity: item.severity,
        deadlineSeconds: item.deadlineSeconds,
      })),
    }),
  ]);

  await recordRevision('deadline', tenantId, 'Prazos atualizados', previous);
  return await listDeadlines();
}

export async function replaceKpiTargets(items: readonly KpiTarget[]): Promise<KpiTarget[]> {
  const previous = await listKpiTargets();
  const tenantId = tenant();

  await db().$transaction([
    db().kpiTarget.deleteMany({ where: { tenantId } }),
    db().kpiTarget.createMany({
      data: items.map(item => ({
        tenantId,
        kpiGroup: item.kpiGroup,
        maxBreaches: item.maxBreaches,
        achievementPct: item.achievementPct,
      })),
    }),
  ]);

  await recordRevision('kpi_target', tenantId, 'Metas atualizadas', previous);
  return await listKpiTargets();
}

/** Restores the state a revision recorded, itself recorded as a new revision. */
export async function rollback(revisionId: string): Promise<void> {
  const revision = await db().revision.findFirst({
    where: { id: revisionId, tenantId: tenant() },
  });
  if (!revision) throw new NotFoundError('Esta alteração não está mais no histórico.');
  if (revision.payload === null) {
    throw new ConflictError('Esta alteração não tem um estado anterior para restaurar.');
  }

  switch (revision.domain as ConfigDomain) {
    case 'deadline':
      await replaceDeadlines(revision.payload as unknown as Deadline[]);
      return;
    case 'kpi_target':
      await replaceKpiTargets(revision.payload as unknown as KpiTarget[]);
      return;
    case 'origin':
      await updateBindings(revision.configKey, revision.payload as unknown as FieldBinding[]);
      return;
    default:
      throw new ConflictError('Ainda não é possível reverter uma alteração de dicionário.');
  }
}
