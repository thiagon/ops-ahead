import { AsyncLocalStorage } from 'node:async_hooks';
import { redirect } from 'react-router';
import { gatewayFetch } from '~/features/auth/gateway.server.ts';
import { loginPath } from '~/features/auth/session.server.ts';
import type { AnalysisRequest } from './payload.ts';
import { createAnalysesRepo, type GatewayCall } from './repo.ts';

type TenantScope = {
  tenant: string;
  request: Request;
};

const tenantStore = new AsyncLocalStorage<TenantScope>();

/**
 * Binds this async chain to the tenant in the URL — same shape as
 * features/config/repo.server.ts, so the action can call startAnalysis()
 * without threading the request through every helper.
 */
export async function withTenant<T>(
  request: Request,
  slug: string,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantStore.run({ tenant: slug, request }, fn);
}

function scope(): TenantScope {
  const stored = tenantStore.getStore();
  if (!stored) {
    throw new Error('Nenhum tenant no contexto — as telas passam pelo withTenant.');
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
  return createAnalysesRepo(stored.tenant, serverTransport(stored.request));
}

export async function startAnalysis(body: AnalysisRequest) {
  return repo().start(body);
}
