import { afterEach, describe, expect, it, vi } from 'vitest';
import { gatewayFetch } from '../app/features/auth/gateway.server.ts';
import {
  loginPath,
  readIdentity,
  requireTenantAccess,
} from '../app/features/auth/session.server.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gatewayFetch', () => {
  it('forwards the cookie and echoes the CSRF token on a mutating call', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await gatewayFetch(
      new Request('http://ui.example/', {
        headers: { cookie: 'oa_session=sealed; oa_csrf=csrf-value' },
      }),
      '/sources/locaweb',
      { method: 'PUT', body: '{}' },
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('cookie')).toContain('oa_session=sealed');
    expect(headers.get('x-csrf-token')).toBe('csrf-value');
  });

  it('does not send CSRF on GET', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await gatewayFetch(
      new Request('http://ui.example/', {
        headers: { cookie: 'oa_session=sealed; oa_csrf=csrf-value' },
      }),
      '/auth/me',
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('x-csrf-token')).toBeNull();
  });
});

describe('readIdentity', () => {
  it('returns undefined when there is no cookie to forward', async () => {
    await expect(readIdentity(new Request('http://ui.example/'))).resolves.toBeUndefined();
  });

  it('reads sub and tenants from the gateway', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ sub: 'person', tenants: ['locaweb'] })),
    );

    await expect(
      readIdentity(new Request('http://ui.example/', { headers: { cookie: 'oa_session=sealed' } })),
    ).resolves.toEqual({ sub: 'person', tenants: ['locaweb'] });
  });
});

describe('requireTenantAccess', () => {
  it('is 403 when the slug is not one of the caller’s groups', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ sub: 'person', tenants: ['locaweb'] })),
    );

    const error = await requireTenantAccess(
      new Request('http://ui.example/alheio', { headers: { cookie: 'oa_session=sealed' } }),
      'alheio',
    ).catch(err => err);

    expect(error).toBeInstanceOf(Response);
    expect(error.status).toBe(403);
  });
});

describe('loginPath', () => {
  it('sends the browser to the gateway with only a path as next', () => {
    expect(loginPath(new Request('http://ui.example/painel'))).toContain(
      '/auth/login?next=%2Fpainel',
    );
  });
});
