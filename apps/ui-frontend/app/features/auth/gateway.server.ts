import { getConfig } from '~/config.server.ts';

const CSRF_COOKIE = 'oa_csrf';
const CSRF_HEADER = 'x-csrf-token';

function gatewayUrl(): string {
  return getConfig().GATEWAY_URL.replace(/\/$/, '');
}

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Calls the gateway forwarding the browser's cookie, and echoing `oa_csrf`
 * on methods that change state. The cookie is HttpOnly on the gateway, so
 * the only way the front spends it is this server-side hop
 * (docs/spec-gateway-auth-v2.md).
 */
export async function gatewayFetch(
  request: Request,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = cookieValue(cookie, CSRF_COOKIE);
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }

  if (!headers.has('accept')) headers.set('accept', 'application/json');

  return fetch(`${gatewayUrl()}${path}`, { ...init, headers, credentials: 'include' });
}
