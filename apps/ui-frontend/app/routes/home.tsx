import { useState } from 'react';
import { Link, redirect } from 'react-router';
import { Logo } from '~/components/Logo';
import { RouteError } from '~/components/RouteError';
import { fetchIdentity, loginUrl, logout } from '~/features/auth/gateway.client.ts';
import { panelPath } from '~/paths';
import { useSession } from '~/session';
import type { Route } from './+types/home';

export function meta() {
  return [{ title: 'Ops Ahead' }];
}

/**
 * The entry screen lists what the person may open, rather than asking them to
 * name it: the tenants come from their Authentik groups, so a slug typed by
 * hand never reaches a client that is not theirs.
 */
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const identity = await fetchIdentity();
  const next = new URL(request.url);
  if (!identity) return { tenants: [], loginUrl: loginUrl(`${next.pathname}${next.search}`) };

  // One client and nothing to choose between — go straight in.
  if (identity.tenants.length === 1) {
    const only = identity.tenants[0];
    if (only) throw redirect(panelPath(only));
  }
  return { tenants: identity.tenants, loginUrl: null };
}

export function HydrateFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-sm text-text-muted">
      Carregando…
    </main>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { tenants, loginUrl } = loaderData;
  const lastSlug = useSession(state => state.lastSlug);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const next = await logout();
      window.location.assign(next ?? '/');
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Logo />
          <div>
            <p className="font-semibold text-text-light">Ops Ahead</p>
            <p className="text-text-dim text-xs">Sempre à frente</p>
          </div>
        </div>

        {loginUrl ? (
          <>
            <h1 className="font-bold text-2xl text-text-light">Entrar</h1>
            <p className="mt-2 text-sm text-text-dim">
              A autenticação acontece no provedor de identidade.
            </p>
            <a
              href={loginUrl}
              className="mt-8 flex h-10 items-center justify-center rounded-lg bg-accent-red px-4 font-semibold text-sm text-text-light transition-opacity hover:opacity-90"
            >
              Continuar
            </a>
          </>
        ) : (
          <>
            <h1 className="font-bold text-2xl text-text-light">Escolher cliente</h1>
            <p className="mt-2 text-sm text-text-dim">
              {tenants.length === 0
                ? 'Sua conta ainda não está em nenhum cliente.'
                : 'Você opera mais de um.'}
            </p>

            <ul className="mt-8 flex flex-col gap-2">
              {tenants.map(slug => (
                <li key={slug}>
                  <Link
                    to={panelPath(slug)}
                    className={`flex h-11 items-center rounded-lg border border-white/10 px-4 font-mono text-sm transition-colors hover:border-white/25 ${
                      slug === lastSlug ? 'text-text-light' : 'text-text-dim'
                    }`}
                  >
                    {slug}
                  </Link>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => void signOut()}
              disabled={signingOut}
              className="mt-6 text-sm text-text-dim hover:text-text-light disabled:opacity-50"
            >
              Sair
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Ops Ahead" service="O gateway" />;
}
