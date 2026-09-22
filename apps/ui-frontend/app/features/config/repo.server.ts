import { AsyncLocalStorage } from 'node:async_hooks';
import { redirect } from 'react-router';
import { gatewayFetch } from '~/features/auth/gateway.server.ts';
import { loginPath } from '~/features/auth/session.server.ts';
import { createConfigRepo, type GatewayCall, MisconfiguredError } from './repo.ts';

export {
  ConflictError,
  type Integration,
  type IntegrationListItem,
  MisconfiguredError,
  NotFoundError,
  type Revision,
} from './repo.ts';

/** The tenant in scope — the URL slug, which is also the Authentik group. */
export type ActiveTenant = {
  slug: string;
  name: string;
};

type TenantScope = {
  tenant: ActiveTenant;
  request: Request;
};

const tenantStore = new AsyncLocalStorage<TenantScope>();

/**
 * Binds this async chain to the tenant in the URL. Nested loaders run in
 * parallel, so every loader/action that reads tenant-scoped data must call
 * this itself — a parent loader cannot leak the store downward.
 *
 * Existence is the claim's: the caller already passed `requireTenantAccess`.
 * The request is stored so config reads can spend the same cookie the
 * browser sent (features/auth/gateway.server.ts).
 */
export async function withTenant<T>(
  request: Request,
  slug: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantStore.run({ tenant: { slug, name: slug }, request }, fn);
}

/**
 * The tenant bound by `withTenant`. ClickHouse queries use the slug as
 * `tenant_id`; there is no numeric id on this side of the gateway.
 */
export async function currentTenant(): Promise<ActiveTenant> {
  const fromStore = tenantStore.getStore();
  if (fromStore) return fromStore.tenant;
  throw new MisconfiguredError('Nenhum tenant no contexto — as telas passam pelo withTenant.');
}

function scope(): TenantScope {
  const stored = tenantStore.getStore();
  if (!stored) {
    throw new MisconfiguredError('Nenhum tenant no contexto — as telas passam pelo withTenant.');
  }
  return stored;
}

const serverTransport =
  (request: Request): GatewayCall =>
  async (path, init) => {
    const response = await gatewayFetch(request, path, init);
    if (response.status === 401) throw redirect(loginPath(request));
    return response;
  };

function repo() {
  const stored = scope();
  return createConfigRepo(stored.tenant.slug, serverTransport(stored.request));
}

export async function listIntegrations() {
  return repo().listIntegrations();
}

export async function getIntegration(source: string) {
  return repo().getIntegration(source);
}

export async function listDeadlines() {
  return repo().listDeadlines();
}

export async function listKpiTargets() {
  return repo().listKpiTargets();
}

export async function listRevisions(
  domains?: Parameters<ReturnType<typeof createConfigRepo>['listRevisions']>[0],
) {
  return repo().listRevisions(domains);
}

export async function createIntegration(
  input: Parameters<ReturnType<typeof createConfigRepo>['createIntegration']>[0],
) {
  return repo().createIntegration(input);
}

export async function rotateSecret(source: string) {
  return repo().rotateSecret(source);
}

export async function setOriginStatus(
  source: string,
  status: Parameters<ReturnType<typeof createConfigRepo>['setOriginStatus']>[1],
) {
  return repo().setOriginStatus(source, status);
}

export async function updateBindings(
  source: string,
  bindings: Parameters<ReturnType<typeof createConfigRepo>['updateBindings']>[1],
) {
  return repo().updateBindings(source, bindings);
}

export async function upsertMapping(
  source: string,
  input: Parameters<ReturnType<typeof createConfigRepo>['upsertMapping']>[1],
) {
  return repo().upsertMapping(source, input);
}

export async function removeMapping(
  source: string,
  field: Parameters<ReturnType<typeof createConfigRepo>['removeMapping']>[1],
  from: Parameters<ReturnType<typeof createConfigRepo>['removeMapping']>[2],
) {
  return repo().removeMapping(source, field, from);
}

export async function replaceDeadlines(
  items: Parameters<ReturnType<typeof createConfigRepo>['replaceDeadlines']>[0],
) {
  return repo().replaceDeadlines(items);
}

export async function replaceKpiTargets(
  items: Parameters<ReturnType<typeof createConfigRepo>['replaceKpiTargets']>[0],
) {
  return repo().replaceKpiTargets(items);
}

/** Restores a published document by writing it again — the gateway keeps history. */
export async function rollback(revisionId: number) {
  return repo().rollback(revisionId);
}
