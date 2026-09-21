import { useEffect } from 'react';
import { Link, Outlet } from 'react-router';
import { fetchOpenAlertCount } from '~/clickhouse.server.ts';
import { RouteError } from '~/components/RouteError';
import { Sidebar } from '~/components/Sidebar';
import { requireTenantAccess } from '~/features/auth/session.server.ts';
import { currentTenant, withTenant } from '~/features/config/repo.server.ts';
import { useSession } from '~/session';
import type { Route } from './+types/tenant';

/**
 * Resolves the tenant from the URL slug and wraps the chrome every tenant
 * screen shares. Child loaders still call `withTenant` themselves: nested
 * loaders run in parallel, so they cannot inherit this request's store.
 *
 * Access is checked before the slug is resolved: an unauthorized caller must
 * not learn whether a client exists.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  await requireTenantAccess(request, params.tenant);
  return withTenant(params.tenant, async () => ({
    tenant: await currentTenant(),
    openCount: await fetchOpenAlertCount().catch(() => null),
  }));
}

export default function TenantLayout({ loaderData }: Route.ComponentProps) {
  const { tenant, openCount } = loaderData;
  const enter = useSession(state => state.enter);

  useEffect(() => {
    enter(tenant);
  }, [enter, tenant]);

  return (
    <div className="flex min-h-screen">
      <Sidebar tenant={tenant} openCount={openCount} />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <div className="min-h-screen">
      <RouteError error={error} title="Cliente" service="O cadastro de clientes" />
      <p className="px-8 pb-8">
        <Link to="/" className="text-sm text-text-muted hover:text-text-light">
          ← Trocar identificador
        </Link>
      </p>
    </div>
  );
}
