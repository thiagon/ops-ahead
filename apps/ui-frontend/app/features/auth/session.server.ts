import { redirect } from 'react-router';
import { getConfig } from '~/config.server.ts';
import { gatewayFetch } from './gateway.server.ts';

/**
 * Who the gateway says is calling, read from its `/auth/me` on every request
 * that needs it. This app stores no session of its own: the cookie belongs to
 * the gateway, which is the only side that can open it
 * (docs/spec-gateway-auth-v2.md).
 */
export interface Identity {
  sub: string;
  /** Tenants the person operates — Authentik group names, verbatim. */
  tenants: string[];
}

/**
 * Asks the gateway who the caller is, forwarding their cookie. `undefined`
 * means "no live session" — the gateway does not distinguish an expired
 * cookie from a revoked token, and neither does this.
 */
export async function readIdentity(request: Request): Promise<Identity | undefined> {
  const cookie = request.headers.get('cookie');
  if (!cookie) return undefined;

  const response = await gatewayFetch(request, '/auth/me');
  if (!response.ok) return undefined;
  return (await response.json()) as Identity;
}

/** For a loader that has nothing to render to a stranger. */
export async function requireIdentity(request: Request): Promise<Identity> {
  const identity = await readIdentity(request);
  if (!identity) throw redirect(loginPath(request));
  return identity;
}

/**
 * As `requireIdentity`, and the tenant in the URL has to be one of theirs.
 * Selection is the URL's; authorization is the claim's, so a slug someone
 * types by hand is a 403 rather than a different client's screen.
 */
export async function requireTenantAccess(request: Request, tenant: string): Promise<Identity> {
  const identity = await requireIdentity(request);
  if (!identity.tenants.includes(tenant)) {
    throw new Response('Esse cliente não está entre os seus.', { status: 403 });
  }
  return identity;
}

/** The gateway conducts the login; this app only points the browser at it. */
export function loginPath(request: Request): string {
  const url = new URL(request.url);
  return `${getConfig().PUBLIC_GATEWAY_URL.replace(/\/$/, '')}/auth/login?next=${encodeURIComponent(url.pathname)}`;
}
