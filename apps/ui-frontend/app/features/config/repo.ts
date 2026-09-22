import { parseRulesContract, type RulesContract } from './contract-schema.ts';
import {
  type ConfigDomain,
  type ContractField,
  type Deadline,
  type FieldBinding,
  type Intake,
  isIntegrationReady,
  type KpiTarget,
  kpiGroupKey,
  type LabelEntry,
  type MappingEntry,
  type MappingField,
  type Status,
} from './types.ts';

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

/** An integration as the screens read it — the source plus what it maps. */
export interface Integration {
  source: string;
  intake: Intake;
  lifecycle: Status;
  enabled: boolean;
  dictionaryVersion: string | null;
  dictionaryStatus: Status | null;
  bindings: FieldBinding[];
  mappings: Partial<Record<MappingField, MappingEntry[]>>;
  fields: ContractField[];
}

export interface IntegrationListItem {
  source: string;
  intake: Intake;
  lifecycle: Status;
}

export interface Revision {
  id: number;
  domain: ConfigDomain;
  summary: string;
  at: string;
  revertible: boolean;
  payload: unknown;
}

type SourceStatus = 'active' | 'disabled';

type SourceSummary = {
  tenant_id: string;
  source: string;
  intake: Intake;
  status: SourceStatus;
};

type LabelBinding = string | { key: string; path: string }[];

type MappingDocument = {
  intake: Intake;
  version: string;
  bindings: Record<string, string | LabelBinding | undefined>;
  mappings: Partial<Record<MappingField, Record<string, string>>>;
};

type ErrorBody = {
  error?: string;
  message?: string;
};

export type GatewayCall = (path: string, init?: RequestInit) => Promise<Response>;

function lifecycleOf(status: SourceStatus): Status {
  return status === 'active' ? 'active' : 'inactive';
}

function toGatewayStatus(status: Status): SourceStatus {
  return status === 'active' ? 'active' : 'disabled';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isLabelEntry(value: unknown): value is LabelEntry {
  const row = asRecord(value);
  return typeof row?.key === 'string' && typeof row.path === 'string';
}

function bindingsFrom(
  fields: readonly ContractField[],
  document: MappingDocument | null,
): FieldBinding[] {
  const raw = document?.bindings ?? {};
  return fields.map(field => {
    const value = raw[field.field];
    if (field.kind === 'labels' && Array.isArray(value)) {
      return { field: field.field, path: null, labels: value.filter(isLabelEntry) };
    }
    if (typeof value === 'string') return { field: field.field, path: value, labels: null };
    return { field: field.field, path: null, labels: null };
  });
}

function mappingsFrom(document: MappingDocument | null): Integration['mappings'] {
  const raw = document?.mappings ?? {};
  const result: Integration['mappings'] = {};
  for (const [field, pairs] of Object.entries(raw)) {
    if (!pairs) continue;
    result[field as MappingField] = Object.entries(pairs).map(([from, to]) => ({ from, to }));
  }
  return result;
}

function toGatewayBindings(
  bindings: readonly FieldBinding[],
): Record<string, string | LabelBinding> {
  const out: Record<string, string | LabelBinding> = {};
  for (const binding of bindings) {
    if (binding.labels && binding.labels.length > 0) {
      out[binding.field] = [...binding.labels];
      continue;
    }
    if (binding.path) out[binding.field] = binding.path;
  }
  return out;
}

function deadlineItems(value: unknown): Deadline[] {
  const record = asRecord(value);
  const nested = asRecord(record?.document);
  const list = Array.isArray(value)
    ? value
    : asArray(record?.deadlines).length > 0
      ? asArray(record?.deadlines)
      : asArray(nested?.deadlines);
  const rows: Deadline[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const severity = Number(row.severity);
    const seconds = Number(row.seconds ?? row.deadlineSeconds);
    if (!Number.isInteger(severity) || !Number.isFinite(seconds)) continue;
    rows.push({ severity, deadlineSeconds: seconds });
  }
  return rows.sort((a, b) => a.severity - b.severity);
}

function targetItems(value: unknown): KpiTarget[] {
  const record = asRecord(value);
  const nested = asRecord(record?.document);
  const list = Array.isArray(value)
    ? value
    : asArray(record?.targets).length > 0
      ? asArray(record?.targets)
      : asArray(nested?.targets);
  const rows: KpiTarget[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const severities = asArray(row.severities)
      .map(Number)
      .filter(severity => Number.isInteger(severity) && severity > 0);
    const maxBreaches = Number(row.max_breaches ?? row.maxBreaches);
    const achievementPct = Number(row.achievement_pct ?? row.achievementPct);
    if (
      severities.length === 0 ||
      !Number.isFinite(maxBreaches) ||
      !Number.isFinite(achievementPct)
    ) {
      continue;
    }
    rows.push({ severities, maxBreaches, achievementPct });
  }
  return rows.sort((a, b) => {
    const byGroup = kpiGroupKey(a.severities).localeCompare(kpiGroupKey(b.severities));
    if (byGroup !== 0) return byGroup;
    return b.achievementPct - a.achievementPct;
  });
}

function historyStamp(value: unknown): { id: number; at: string } | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = Number(record.id);
  const at =
    typeof record.created_at === 'string'
      ? record.created_at
      : typeof record.createdAt === 'string'
        ? record.createdAt
        : '';
  if (!Number.isInteger(id) || at.length === 0) return null;
  return { id, at };
}

function errorMessage(body: unknown, text: string, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as ErrorBody;
    if (typeof record.message === 'string' && record.message.length > 0) return record.message;
    if (typeof record.error === 'string' && record.error.length > 0) return record.error;
  }
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 2000);
  return fallback;
}

/**
 * Configuration registry calls. `transport` is either the server hop that
 * forwards the cookie or the browser calling the public gateway.
 */
export function createConfigRepo(tenant: string, transport: GatewayCall) {
  function tenantId(): string {
    return tenant;
  }

  async function api(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body != null && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return transport(path, { ...init, headers });
  }

  async function expectOk(response: Response, fallback: string): Promise<unknown> {
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = null;
      }
    }
    if (response.ok) return body;
    const message = `${response.status} ${response.url}: ${errorMessage(body, text, fallback)}`;
    if (response.status === 404) throw new NotFoundError(message);
    throw new ConflictError(message);
  }

  async function getOptional<T>(path: string): Promise<T | null> {
    const response = await api(path);
    if (response.status === 404) return null;
    return (await expectOk(response, 'Falha ao ler a configuração.')) as T;
  }

  async function listSources(): Promise<SourceSummary[]> {
    const body = await expectOk(
      await api(`/sources/${encodeURIComponent(tenantId())}`),
      'Falha ao listar as origens.',
    );
    return Array.isArray(body) ? (body as SourceSummary[]) : [];
  }

  async function findSource(source: string): Promise<SourceSummary> {
    const found = (await listSources()).find(row => row.source === source);
    if (!found) throw new NotFoundError(`Integração ${source} não existe.`);
    return found;
  }

  let contract: Promise<RulesContract> | undefined;

  async function loadContract(): Promise<RulesContract> {
    contract ??= (async () => {
      const body = await expectOk(await api('/rules/schema'), 'Falha ao ler o schema das regras.');
      return parseRulesContract(body);
    })();
    return contract;
  }

  async function compose(
    source: SourceSummary,
    mapping: MappingDocument | null,
  ): Promise<Integration> {
    const fields = (await loadContract()).fields[source.intake];
    return {
      source: source.source,
      intake: source.intake,
      lifecycle: lifecycleOf(source.status),
      enabled: source.status === 'active',
      dictionaryVersion: mapping?.version ?? null,
      dictionaryStatus: mapping ? 'active' : 'inactive',
      bindings: bindingsFrom(fields, mapping),
      mappings: mappingsFrom(mapping),
      fields,
    };
  }

  function mappingPath(source: string): string {
    return `/rules/mappings/${encodeURIComponent(tenantId())}/${encodeURIComponent(source)}`;
  }

  async function loadMapping(source: string): Promise<MappingDocument | null> {
    return await getOptional<MappingDocument>(mappingPath(source));
  }

  async function putMapping(source: string, document: MappingDocument): Promise<void> {
    await expectOk(
      await api(mappingPath(source), { method: 'PUT', body: JSON.stringify(document) }),
      'A configuração não passou na validação.',
    );
  }

  async function listIntegrations(): Promise<IntegrationListItem[]> {
    return (await listSources())
      .map(row => ({
        source: row.source,
        intake: row.intake,
        lifecycle: lifecycleOf(row.status),
      }))
      .sort((a, b) => a.source.localeCompare(b.source));
  }

  async function getIntegration(source: string): Promise<Integration> {
    const origin = await findSource(source);
    return await compose(origin, await loadMapping(source));
  }

  async function listDeadlines(): Promise<Deadline[]> {
    return deadlineItems(await getOptional(`/rules/deadlines/${encodeURIComponent(tenantId())}`));
  }

  async function listKpiTargets(): Promise<KpiTarget[]> {
    return targetItems(await getOptional(`/rules/targets/${encodeURIComponent(tenantId())}`));
  }

  async function listRevisions(domains?: readonly ConfigDomain[]): Promise<Revision[]> {
    const wanted = new Set(domains ?? ['deadline', 'kpi_target']);
    const id = encodeURIComponent(tenantId());
    const rows: Revision[] = [];

    if (wanted.has('deadline')) {
      for (const item of asArray(await getOptional(`/rules/deadlines/${id}/history`))) {
        const stamp = historyStamp(item);
        if (!stamp) continue;
        rows.push({
          id: stamp.id,
          domain: 'deadline',
          summary: 'Prazos publicados',
          at: stamp.at,
          revertible: true,
          payload: deadlineItems(item),
        });
      }
    }

    if (wanted.has('kpi_target')) {
      for (const item of asArray(await getOptional(`/rules/targets/${id}/history`))) {
        const stamp = historyStamp(item);
        if (!stamp) continue;
        rows.push({
          id: stamp.id,
          domain: 'kpi_target',
          summary: 'Metas publicadas',
          at: stamp.at,
          revertible: true,
          payload: targetItems(item),
        });
      }
    }

    return rows.sort((a, b) => b.at.localeCompare(a.at));
  }

  async function createIntegration(input: {
    source: string;
    intake: Intake;
  }): Promise<{ integration: Integration; secret: string }> {
    const existing = (await listSources()).find(row => row.source === input.source);
    if (existing) throw new ConflictError(`Já existe uma integração chamada ${input.source}.`);

    const created = (await expectOk(
      await api(`/sources/${encodeURIComponent(tenantId())}/${encodeURIComponent(input.source)}`, {
        method: 'PUT',
        body: JSON.stringify({ intake: input.intake }),
      }),
      'Não foi possível criar a integração.',
    )) as { source: SourceSummary; secret: string };

    await expectOk(
      await api(
        `/sources/${encodeURIComponent(tenantId())}/${encodeURIComponent(input.source)}/status`,
        { method: 'PUT', body: JSON.stringify({ status: 'disabled' }) },
      ),
      'Não foi possível criar a integração.',
    );

    return { integration: await getIntegration(created.source.source), secret: created.secret };
  }

  async function rotateSecret(source: string): Promise<string> {
    const body = (await expectOk(
      await api(`/sources/${encodeURIComponent(tenantId())}/${encodeURIComponent(source)}/secret`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      `Integração ${source} não existe.`,
    )) as { secret: string };
    return body.secret;
  }

  async function setOriginStatus(source: string, status: Status): Promise<Integration> {
    const current = await getIntegration(source);
    const next = toGatewayStatus(status);
    if (lifecycleOf(next) === current.lifecycle) return current;
    if (next === 'active' && !isIntegrationReady(current)) {
      throw new ConflictError(
        'A integração só ativa quando todos os campos obrigatórios e os valores do vocabulário estão configurados.',
      );
    }

    await expectOk(
      await api(`/sources/${encodeURIComponent(tenantId())}/${encodeURIComponent(source)}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: next }),
      }),
      `Integração ${source} não existe.`,
    );
    return await getIntegration(source);
  }

  async function updateBindings(
    source: string,
    bindings: readonly FieldBinding[],
  ): Promise<Integration> {
    const origin = await findSource(source);
    const current = await loadMapping(source);
    await putMapping(source, {
      intake: origin.intake,
      version: current?.version ?? 'v1',
      bindings: toGatewayBindings(bindings),
      mappings: current?.mappings ?? {},
    });
    return await getIntegration(source);
  }

  async function upsertMapping(
    source: string,
    input: { field: MappingField; from: string; to: string },
  ): Promise<Integration> {
    const origin = await findSource(source);
    const current = await loadMapping(source);
    if (!current) {
      throw new ConflictError('Publique os campos da origem antes de mapear valores.');
    }
    const fieldMap = { ...(current.mappings[input.field] ?? {}) };
    fieldMap[input.from] = input.to;
    await putMapping(source, {
      intake: origin.intake,
      version: current.version,
      bindings: current.bindings,
      mappings: { ...current.mappings, [input.field]: fieldMap },
    });
    return await getIntegration(source);
  }

  async function removeMapping(
    source: string,
    field: MappingField,
    from: string,
  ): Promise<Integration> {
    const origin = await findSource(source);
    const current = await loadMapping(source);
    const fieldMap = { ...(current?.mappings[field] ?? {}) };
    if (!current || !(from in fieldMap)) {
      throw new NotFoundError('Este valor já não está mapeado.');
    }
    delete fieldMap[from];
    const mappings = { ...current.mappings };
    if (Object.keys(fieldMap).length === 0) {
      delete mappings[field];
    } else {
      mappings[field] = fieldMap;
    }
    await putMapping(source, {
      intake: origin.intake,
      version: current.version,
      bindings: current.bindings,
      mappings,
    });
    return await getIntegration(source);
  }

  async function replaceDeadlines(items: readonly Deadline[]): Promise<Deadline[]> {
    if (items.length === 0) {
      throw new ConflictError('Publique pelo menos um prazo.');
    }
    await expectOk(
      await api(`/rules/deadlines/${encodeURIComponent(tenantId())}`, {
        method: 'PUT',
        body: JSON.stringify({
          deadlines: items.map(item => ({
            severity: item.severity,
            seconds: item.deadlineSeconds,
          })),
        }),
      }),
      'Não foi possível publicar os prazos.',
    );
    return await listDeadlines();
  }

  async function replaceKpiTargets(items: readonly KpiTarget[]): Promise<KpiTarget[]> {
    if (items.length === 0) {
      throw new ConflictError('Publique pelo menos uma meta.');
    }
    await expectOk(
      await api(`/rules/targets/${encodeURIComponent(tenantId())}`, {
        method: 'PUT',
        body: JSON.stringify({
          targets: items.map(item => ({
            severities: item.severities,
            max_breaches: item.maxBreaches,
            achievement_pct: item.achievementPct,
          })),
        }),
      }),
      'Não foi possível publicar as metas.',
    );
    return await listKpiTargets();
  }

  async function rollback(revisionId: number): Promise<void> {
    const revision = (await listRevisions()).find(row => row.id === revisionId);
    if (!revision) throw new NotFoundError('Esta alteração não está mais no histórico.');

    switch (revision.domain) {
      case 'deadline':
        await replaceDeadlines(revision.payload as Deadline[]);
        return;
      case 'kpi_target':
        await replaceKpiTargets(revision.payload as KpiTarget[]);
        return;
      default:
        throw new ConflictError('Ainda não é possível reverter esta alteração pela tela.');
    }
  }

  return {
    listIntegrations,
    getIntegration,
    listDeadlines,
    listKpiTargets,
    listRevisions,
    createIntegration,
    rotateSecret,
    setOriginStatus,
    updateBindings,
    upsertMapping,
    removeMapping,
    replaceDeadlines,
    replaceKpiTargets,
    rollback,
  };
}
