import { getConfig } from '~/config.server.ts';
import type {
  ConfigRevision,
  Deadline,
  FieldBinding,
  Intake,
  KpiTarget,
  MappingEntry,
  MappingField,
} from './types.ts';

/**
 * Reads and writes the tenant's configuration through the configuration API
 * (ui-orchestrator). Every screen goes through here — no route module talks to
 * the backing store directly.
 */

/** An integration as the API returns it — the origin plus what it maps. */
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

export class ConfigApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`config api ${status}: ${detail}`);
    this.name = 'ConfigApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const config = getConfig();
  const request = new Request(new URL(path, config.CONFIG_API_URL), {
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(config.CONFIG_API_TIMEOUT_MS),
    ...init,
  });
  return await fetch(request);
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  if (!response.ok) {
    // Fastify answers `message` on a handled error and `detail` on a 404 from
    // the service layer.
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
      message?: string;
    };
    throw new ConfigApiError(response.status, body.detail ?? body.message ?? response.statusText);
  }
  // A write that changes state and returns nothing answers 204 — parsing it as
  // JSON would fail on an empty body.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  return await call<T>(path);
}

function write<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return call<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function tenantPath(suffix: string): string {
  return `/tenants/${encodeURIComponent(getConfig().TENANT_ID)}${suffix}`;
}

export async function listIntegrations(): Promise<Integration[]> {
  const body = await get<{ items: Integration[] }>(tenantPath('/integrations'));
  return body.items;
}

export async function getIntegration(source: string): Promise<Integration> {
  return await get<Integration>(tenantPath(`/integrations/${encodeURIComponent(source)}`));
}

export async function listDeadlines(): Promise<Omit<Deadline, 'tenantId'>[]> {
  const body = await get<{ items: Omit<Deadline, 'tenantId'>[] }>(tenantPath('/deadlines'));
  return body.items;
}

export async function listKpiTargets(): Promise<Omit<KpiTarget, 'tenantId'>[]> {
  const body = await get<{ items: Omit<KpiTarget, 'tenantId'>[] }>(tenantPath('/kpi-targets'));
  return body.items;
}

export async function listRevisions(): Promise<Omit<ConfigRevision, 'tenantId'>[]> {
  const body = await get<{ items: Omit<ConfigRevision, 'tenantId'>[] }>(tenantPath('/revisions'));
  return body.items;
}

export function createIntegration(input: {
  source: string;
  intake: Intake;
  envelopeVersion: string;
}): Promise<Integration & { secret: string }> {
  return write('POST', tenantPath('/integrations'), input);
}

export function rotateSecret(source: string): Promise<{ secret: string; createdAt: string }> {
  return write('POST', tenantPath(`/integrations/${encodeURIComponent(source)}/secret`));
}

export function updateBindings(
  source: string,
  bindings: readonly FieldBinding[],
): Promise<Integration> {
  return write('PUT', tenantPath(`/integrations/${encodeURIComponent(source)}/bindings`), {
    bindings,
  });
}

export function upsertMapping(
  source: string,
  input: { field: MappingField; from: string; to: string },
): Promise<Integration> {
  return write('POST', tenantPath(`/integrations/${encodeURIComponent(source)}/mappings`), input);
}

export function removeMapping(source: string, mappingId: string): Promise<Integration> {
  return write(
    'DELETE',
    tenantPath(
      `/integrations/${encodeURIComponent(source)}/mappings/${encodeURIComponent(mappingId)}`,
    ),
  );
}

export function replaceDeadlines(
  items: readonly Omit<Deadline, 'tenantId'>[],
): Promise<{ items: Omit<Deadline, 'tenantId'>[] }> {
  return write('PUT', tenantPath('/deadlines'), { items });
}

export function replaceKpiTargets(
  items: readonly Omit<KpiTarget, 'tenantId'>[],
): Promise<{ items: Omit<KpiTarget, 'tenantId'>[] }> {
  return write('PUT', tenantPath('/kpi-targets'), { items });
}

export function rollbackRevision(revisionId: string): Promise<void> {
  return write('POST', tenantPath(`/revisions/${encodeURIComponent(revisionId)}/rollback`));
}
