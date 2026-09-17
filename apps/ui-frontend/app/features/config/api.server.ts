import { getConfig } from '~/config.server.ts';
import { handleConfigRequest } from './api.mock.ts';
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
 * Reads the tenant's configuration from the configuration API. Every screen
 * goes through here — no route module talks to the backing store directly.
 *
 * The API does not exist yet, so requests are answered in-process by
 * config-api.mock.server.ts. Only `send` knows that: it is the single line that
 * becomes `fetch(request)` once ui-orchestrator serves these routes.
 */

/** An integration as the API returns it — the origin plus what it maps. */
export interface Integration {
  source: string;
  intake: Intake;
  envelopeVersion: string;
  secretCreatedAt: string;
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

async function send(path: string): Promise<Response> {
  const config = getConfig();
  const request = new Request(new URL(path, config.CONFIG_API_URL), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(config.CONFIG_API_TIMEOUT_MS),
  });
  return await handleConfigRequest(request);
}

async function get<T>(path: string): Promise<T> {
  const response = await send(path);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ConfigApiError(response.status, body.detail ?? response.statusText);
  }
  return (await response.json()) as T;
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
