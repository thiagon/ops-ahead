import { useEffect } from 'react';
import { Link, Outlet, redirect } from 'react-router';
import { readJson } from '~/client-fetch.ts';
import { RouteError } from '~/components/RouteError';
import { Sidebar } from '~/components/Sidebar';
import { fetchIdentity, loginUrl } from '~/features/auth/gateway.client.ts';
import { useSession } from '~/session';
import type { Route } from './+types/tenant';

/**
 * Access is the claim's — an unauthorized caller never reaches the slug.
 * The check runs in the browser, against the gateway, so a refused call
 * stays visible in the network panel.
 */
export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  const tenant = params.tenant;
  if (!tenant) throw new Response('Tenant ausente', { status: 400 });

  const next = new URL(request.url);
  const identity = await fetchIdentity();
  if (!identity) throw redirect(loginUrl(`${next.pathname}${next.search}`));
  if (!identity.tenants.includes(tenant)) {
    throw new Response('Esse cliente não está entre os seus.', { status: 403 });
  }

  let openCount: number | null = null;
  try {
    openCount = await readJson<number>(`/data/${encodeURIComponent(tenant)}/open-count`);
  } catch (error) {
    console.error(error);
    openCount = null;
  }

  const operator = { sub: identity.sub, name: identity.name, email: identity.email };
  return { tenant: { slug: tenant, name: tenant }, operator, openCount };
}

export function HydrateFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-sm text-text-muted">
      Carregando…
    </main>
  );
}

export default function TenantLayout({ loaderData }: Route.ComponentProps) {
  const { tenant, operator, openCount } = loaderData;
  const enter = useSession(state => state.enter);

  useEffect(() => {
    enter(tenant);
  }, [enter, tenant]);

  return (
    <div className="flex min-h-screen">
      <Sidebar tenant={tenant} operator={operator} openCount={openCount} />
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
