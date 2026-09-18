import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';
import { getConfig } from '~/config.server.ts';
import {
  type ConfigDomain,
  type Deadline,
  type FieldBinding,
  type Intake,
  isIntegrationReady,
  type KpiTarget,
  kpiGroupKey,
  type MappingEntry,
  type MappingField,
  type Status,
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void cached?.$disconnect();
    cached = undefined;
  });
}

/** An integration as the screens read it — the origin plus what it maps. */
export interface Integration {
  source: string;
  intake: Intake;
  envelopeVersion: string;
  secretCreatedAt: string | null;
  lifecycle: Status;
  enabled: boolean;
  dictionaryVersion: string | null;
  dictionaryStatus: Status | null;
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

export class MisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MisconfiguredError';
  }
}

/** The tenant in scope — numeric id for FKs, slug for URLs and ClickHouse. */
export type ActiveTenant = {
  id: number;
  slug: string;
  name: string;
};

const tenantStore = new AsyncLocalStorage<ActiveTenant>();

let cachedTenant: ActiveTenant | undefined;

/** Clears the in-process cache — tests reseeding the fallback tenant need it. */
export function clearTenantCache(): void {
  cachedTenant = undefined;
}

export async function getTenantBySlug(slug: string): Promise<ActiveTenant | null> {
  const row = await db().tenant.findUnique({ where: { slug } });
  if (!row) return null;
  return { id: row.id, slug: row.slug, name: row.name };
}

/**
 * Binds this async chain to a tenant looked up by URL slug. Nested loaders
 * run in parallel, so every loader/action that reads tenant-scoped data
 * must call this itself — a parent loader cannot leak the store downward.
 */
export async function withTenant<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    throw new Response('Cliente não encontrado', { status: 404 });
  }
  return tenantStore.run(tenant, fn);
}

/**
 * The tenant bound by `withTenant`. Tests that are not behind a URL fall
 * back to the one `status = active` row, the same bootstrap the seed marks.
 */
export async function currentTenant(): Promise<ActiveTenant> {
  const fromStore = tenantStore.getStore();
  if (fromStore) return fromStore;

  if (cachedTenant) return cachedTenant;

  const row = await db().tenant.findFirst({ where: { status: 'active' } });
  if (!row) {
    throw new MisconfiguredError(
      'Nenhum tenant ativo no cadastro — rode o seed ou marque um como active.',
    );
  }

  cachedTenant = { id: row.id, slug: row.slug, name: row.name };
  return cachedTenant;
}

async function activeTenantId(): Promise<number> {
  return (await currentTenant()).id;
}

/** Until the screens have login, the history is real and its authorship is not. */
const AUTHOR = 'anonymous';

type OriginWithRelations = {
  id: number;
  source: string;
  intake: Intake;
  envelopeVersion: string;
  secretCreatedAt: Date | null;
  status: Status;
  dictionary: { version: string; status: Status } | null;
  bindings: { field: string; path: string | null }[];
  mappings: { id: number; mappingField: string; fromValue: string; toValue: string }[];
};

function compose(origin: OriginWithRelations): Integration {
  return {
    source: origin.source,
    intake: origin.intake,
    envelopeVersion: origin.envelopeVersion,
    secretCreatedAt: origin.secretCreatedAt?.toISOString() ?? null,
    lifecycle: origin.status,
    enabled: origin.status === 'active',
    dictionaryVersion: origin.dictionary?.version ?? null,
    dictionaryStatus: origin.dictionary?.status ?? null,
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
    bindings: { where: { status: 'active' }, orderBy: { field: 'asc' as const } },
    mappings: {
      where: { status: 'active' },
      orderBy: [{ mappingField: 'asc' as const }, { fromValue: 'asc' as const }],
    },
  };
}

async function originRow(source: string) {
  const origin = await db().origin.findUnique({
    where: { tenantId_source: { tenantId: await activeTenantId(), source } },
    include: withRelations(),
  });
  if (!origin) throw new NotFoundError(`Integração ${source} não existe.`);
  return origin;
}

/** List row — origin only. Completeness lives in `lifecycle`, not in the dictionary. */
export interface IntegrationListItem {
  source: string;
  intake: Intake;
  lifecycle: Status;
}

export async function listIntegrations(): Promise<IntegrationListItem[]> {
  const origins = await db().origin.findMany({
    where: { tenantId: await activeTenantId(), status: { not: 'archived' } },
    select: { source: true, intake: true, status: true },
    orderBy: { source: 'asc' },
  });
  return origins.map(row => ({
    source: row.source,
    intake: row.intake,
    lifecycle: row.status,
  }));
}

export async function getIntegration(source: string): Promise<Integration> {
  return compose(await originRow(source));
}

export async function listDeadlines(): Promise<Deadline[]> {
  const rows = await db().deadline.findMany({
    where: { tenantId: await activeTenantId(), status: 'active' },
    orderBy: { severity: 'asc' },
  });
  return rows.map(row => ({ severity: row.severity, deadlineSeconds: row.deadlineSeconds }));
}

export async function listKpiTargets(): Promise<KpiTarget[]> {
  const rows = await db().kpiTarget.findMany({
    where: { tenantId: await activeTenantId(), status: 'active' },
    orderBy: { achievementPct: 'desc' },
  });
  return rows
    .map(row => ({
      severities: row.severities,
      maxBreaches: row.maxBreaches,
      achievementPct: Number(row.achievementPct),
    }))
    .sort((a, b) => {
      const byGroup = kpiGroupKey(a.severities).localeCompare(kpiGroupKey(b.severities));
      if (byGroup !== 0) return byGroup;
      return b.achievementPct - a.achievementPct;
    });
}

export interface Revision {
  id: number;
  domain: ConfigDomain;
  summary: string;
  at: string;
  /** Whether there is a prior state to restore — a creation replaced nothing. */
  revertible: boolean;
  /** The state as it stood before the change. The screen loads this; Publicar writes it. */
  payload: unknown;
}

export async function listRevisions(domains?: readonly ConfigDomain[]): Promise<Revision[]> {
  const rows = await db().revision.findMany({
    where: {
      tenantId: await activeTenantId(),
      ...(domains?.length ? { domain: { in: [...domains] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map(row => ({
    id: row.id,
    domain: row.domain as ConfigDomain,
    summary: row.summary,
    at: row.createdAt.toISOString(),
    revertible: row.payload !== null && row.domain !== 'dictionary',
    payload: row.payload,
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
      tenantId: await activeTenantId(),
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
  const tenantId = await activeTenantId();
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
      status: 'inactive',
      secretCreatedAt: new Date(),
      dictionary: { create: { version: 'v1', status: 'inactive' } },
    },
  });

  await recordRevision('origin', input.source, `Integração ${input.source} criada`, null);

  return { integration: await getIntegration(input.source), secret: generateSecret() };
}

export async function rotateSecret(source: string): Promise<string> {
  const origin = await originRow(source);

  await db().origin.update({
    where: { id: origin.id },
    data: { secretCreatedAt: new Date() },
  });
  await recordRevision('origin', source, `Chave de ${source} rotacionada`, null);

  return generateSecret();
}

/** Inactive stays in the list; archived leaves it. Rows are never deleted. */
export async function setOriginStatus(
  source: string,
  status: Status,
): Promise<Integration> {
  const origin = await originRow(source);
  if (origin.status === status) return compose(origin);
  if (status === 'active' && !isIntegrationReady(compose(origin))) {
    throw new ConflictError(
      'A integração só ativa quando todos os campos obrigatórios e os valores do vocabulário estão configurados.',
    );
  }

  await db().origin.update({
    where: { id: origin.id },
    data: { status },
  });
  const summary =
    status === 'active'
      ? `Integração ${source} ativada`
      : status === 'inactive'
        ? `Integração ${source} inativada`
        : `Integração ${source} arquivada`;
  await recordRevision('origin', source, summary, { status: origin.status });
  return await getIntegration(source);
}

async function demoteIfIncomplete(source: string): Promise<Integration> {
  const origin = await originRow(source);
  const integration = compose(origin);
  if (origin.status !== 'active' || isIntegrationReady(integration)) {
    return integration;
  }
  await db().origin.update({
    where: { id: origin.id },
    data: { status: 'inactive' },
  });
  await recordRevision('origin', source, `Integração ${source} inativada`, {
    status: origin.status,
  });
  return compose({ ...origin, status: 'inactive' });
}

export async function updateBindings(
  source: string,
  bindings: readonly FieldBinding[],
): Promise<Integration> {
  const previous = await getIntegration(source);
  const origin = await originRow(source);

  await db().$transaction(async tx => {
    const fields = bindings.map(binding => binding.field);
    await tx.fieldBinding.updateMany({
      where: { originId: origin.id, field: { notIn: fields } },
      data: { status: 'inactive' },
    });
    for (const binding of bindings) {
      await tx.fieldBinding.upsert({
        where: { originId_field: { originId: origin.id, field: binding.field } },
        update: { path: binding.path, status: 'active' },
        create: {
          originId: origin.id,
          field: binding.field,
          path: binding.path,
          status: 'active',
        },
      });
    }
    // The screen's "Publicar" is this write — draft stays until the customer
    // commits the field paths (and whatever mappings they already added).
    await tx.dictionaryVersion.upsert({
      where: { originId: origin.id },
      update: { status: 'active' },
      create: { originId: origin.id, version: 'v1', status: 'active' },
    });
  });

  await recordRevision('origin', source, `Campos de ${source} atualizados`, previous.bindings);
  return await demoteIfIncomplete(source);
}

export async function upsertMapping(
  source: string,
  input: { field: MappingField; from: string; to: string },
): Promise<Integration> {
  const origin = await originRow(source);

  await db().mapping.upsert({
    where: {
      originId_mappingField_fromValue: {
        originId: origin.id,
        mappingField: input.field,
        fromValue: input.from,
      },
    },
    update: { toValue: input.to, status: 'active' },
    create: {
      originId: origin.id,
      mappingField: input.field,
      fromValue: input.from,
      toValue: input.to,
      status: 'active',
    },
  });

  await recordRevision('dictionary', source, `${input.from} → ${input.to} em ${input.field}`, null);
  return await demoteIfIncomplete(source);
}

export async function removeMapping(source: string, mappingId: number): Promise<Integration> {
  const origin = await originRow(source);
  const entry = await db().mapping.findFirst({
    where: { id: mappingId, originId: origin.id, status: 'active' },
  });
  if (!entry) throw new NotFoundError('Este valor já não está mapeado.');

  await db().mapping.update({
    where: { id: mappingId },
    data: { status: 'inactive' },
  });
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
  const tenantId = await activeTenantId();

  await db().$transaction(async tx => {
    const severities = items.map(item => item.severity);
    await tx.deadline.updateMany({
      where: { tenantId, severity: { notIn: severities } },
      data: { status: 'inactive' },
    });
    for (const item of items) {
      await tx.deadline.upsert({
        where: { tenantId_severity: { tenantId, severity: item.severity } },
        update: { deadlineSeconds: item.deadlineSeconds, status: 'active' },
        create: {
          tenantId,
          severity: item.severity,
          deadlineSeconds: item.deadlineSeconds,
          status: 'active',
        },
      });
    }
  });

  await recordRevision('deadline', (await currentTenant()).slug, 'Prazos atualizados', previous);
  return await listDeadlines();
}

export async function replaceKpiTargets(items: readonly KpiTarget[]): Promise<KpiTarget[]> {
  const previous = await listKpiTargets();
  const tenantId = await activeTenantId();

  await db().$transaction(async tx => {
    const incoming = new Set(
      items.map(item => `${kpiGroupKey(item.severities)}:${item.achievementPct}`),
    );
    const existing = await tx.kpiTarget.findMany({ where: { tenantId } });
    for (const row of existing) {
      if (!incoming.has(`${kpiGroupKey(row.severities)}:${Number(row.achievementPct)}`)) {
        await tx.kpiTarget.update({
          where: { id: row.id },
          data: { status: 'inactive' },
        });
      }
    }
    for (const item of items) {
      const severities = [...item.severities].sort((a, b) => a - b);
      await tx.kpiTarget.upsert({
        where: {
          tenantId_severities_achievementPct: {
            tenantId,
            severities,
            achievementPct: item.achievementPct,
          },
        },
        update: { maxBreaches: item.maxBreaches, status: 'active' },
        create: {
          tenantId,
          severities,
          maxBreaches: item.maxBreaches,
          achievementPct: item.achievementPct,
          status: 'active',
        },
      });
    }
  });

  await recordRevision('kpi_target', (await currentTenant()).slug, 'Metas atualizadas', previous);
  return await listKpiTargets();
}

/** Restores the state a revision recorded, itself recorded as a new revision. */
export async function rollback(revisionId: number): Promise<void> {
  const revision = await db().revision.findFirst({
    where: { id: revisionId, tenantId: await activeTenantId() },
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
