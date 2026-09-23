import type { Role } from './role.ts';

const CSRF_COOKIE = 'oa_csrf';
const CSRF_HEADER = 'x-csrf-token';

export interface Identity {
  sub: string;
  name?: string;
  email?: string;
  tenants: string[];
  role?: Role;
}

/** `PUBLIC_GATEWAY_URL`, written into the document head by the root layout. */
export function gatewayUrl(): string {
  const content = document
    .querySelector('meta[name="gateway-url"]')
    ?.getAttribute('content')
    ?.trim();
  if (!content) {
    throw new Error('PUBLIC_GATEWAY_URL não está no HTML.');
  }
  return content.replace(/\/$/, '');
}

export function loginUrl(nextPath: string): string {
  return `${gatewayUrl()}/auth/login?next=${encodeURIComponent(nextPath)}`;
}

function cookieValue(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const csrf = cookieValue(document.cookie, CSRF_COOKIE);
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }
  if (!headers.has('accept')) headers.set('accept', 'application/json');

  const url = `${gatewayUrl()}${path}`;
  try {
    return await fetch(url, { ...init, headers, credentials: 'include' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${method} ${url} não completou: ${message}`);
  }
}

export async function gatewayError(response: Response): Promise<Error> {
  const text = await response.text();
  let message = text.trim();
  try {
    const body = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof body.message === 'string' && body.message.length > 0) message = body.message;
    else if (typeof body.error === 'string' && body.error.length > 0) message = body.error;
  } catch {
    // The raw body is the message.
  }
  return new Error(`${response.status} ${response.url}: ${message || response.statusText}`);
}

/** Clears the gateway cookie and returns where the browser should go to leave the identity provider. */
export async function logout(): Promise<string | undefined> {
  const response = await gatewayFetch('/auth/logout', { method: 'POST' });
  if (response.status === 401) return undefined;
  if (!response.ok) throw await gatewayError(response);
  const text = await response.text();
  if (!text) return undefined;
  try {
    const body = JSON.parse(text) as { redirect?: unknown };
    if (typeof body.redirect === 'string' && body.redirect.startsWith('http')) return body.redirect;
  } catch {
    // The cookie is already cleared; a body that is not JSON still logs out.
  }
  return undefined;
}

/** `undefined` is a missing session. Any other failure keeps the response body. */
export async function fetchIdentity(): Promise<Identity | undefined> {
  const response = await gatewayFetch('/auth/me');
  if (response.status === 401) return undefined;
  if (!response.ok) throw await gatewayError(response);

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`GET /auth/me devolveu um corpo que não é JSON: ${text.slice(0, 500)}`);
  }
  if (!body || typeof body !== 'object' || !Array.isArray((body as Identity).tenants)) {
    throw new Error(`GET /auth/me devolveu um corpo inesperado: ${text.slice(0, 500)}`);
  }
  return body as Identity;
}
