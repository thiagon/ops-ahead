import { afterEach, describe, expect, it, vi } from 'vitest';
import { OidcService } from '../../../../src/services/oidc/service.ts';

function service(
  issuer = 'http://authentik.example/application/o/gateway-web/',
  internalOrigin?: string,
): OidcService {
  return new OidcService({
    issuer,
    clientId: 'gateway-web',
    clientSecret: 'secret',
    redirectUri: 'http://gateway.example/auth/callback',
    introspectionCacheTtlMs: 5_000,
    internalOrigin,
  });
}

describe('OidcService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('points MCP clients at the public Authentik app', () => {
    expect(service().authorizationServer('gateway-mcp')).toBe(
      'http://authentik.example/application/o/gateway-mcp/',
    );
  });

  it('leaves an issuer it cannot rewrite alone', () => {
    expect(service('http://authentik.example/').authorizationServer('gateway-mcp')).toBe(
      'http://authentik.example/',
    );
  });

  it('asks for the groups scope — that claim is authorization', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ authorization_endpoint: 'http://authentik.example/authorize' }),
      })),
    );

    const oidc = service();
    const url = await oidc.authorizationUrl({ state: 's', codeChallenge: 'c' });

    expect(new URL(url).searchParams.get('scope')).toBe(oidc.scopes);
    expect(new URL(url).searchParams.get('prompt')).toBe('login');
    expect(oidc.scopes.split(' ')).toContain('groups');
  });

  it('reuses an introspection answer inside the cache window', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('openid-configuration')) {
        return {
          ok: true,
          json: async () => ({ introspection_endpoint: 'http://authentik.example/introspect' }),
        };
      }
      return {
        ok: true,
        json: async () => ({ active: true, sub: 'user', groups: ['locaweb'] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const oidc = service();
    await expect(oidc.introspect('tok')).resolves.toEqual({
      sub: 'user',
      groups: ['locaweb'],
      role: 'viewer',
      expiresAt: undefined,
    });
    await expect(oidc.introspect('tok')).resolves.toMatchObject({ sub: 'user' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('introspect'))).toHaveLength(
      1,
    );
  });

  it.each([
    ['operator', 'operator'],
    ['viewer', 'viewer'],
    ['admin', 'viewer'],
    [undefined, 'viewer'],
  ])('reads ops_ahead_role %s as %s', async (claim, role) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('openid-configuration')) {
          return {
            ok: true,
            json: async () => ({ introspection_endpoint: 'http://authentik.example/introspect' }),
          };
        }
        return {
          ok: true,
          json: async () => ({ active: true, sub: 'user', groups: [], ops_ahead_role: claim }),
        };
      }),
    );

    await expect(service().introspect('tok')).resolves.toMatchObject({ role });
  });

  it('treats a failed refresh as a dead session, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('openid-configuration')) {
          return {
            ok: true,
            json: async () => ({ token_endpoint: 'http://authentik.example/token' }),
          };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );

    await expect(service().refresh('stale')).resolves.toBeUndefined();
  });

  it('fetches discovery through the in-cluster origin and keeps the public authorize URL', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      expect(url.startsWith('http://authentik.internal/')).toBe(true);
      return {
        ok: true,
        json: async () => ({
          issuer: 'http://authentik.internal/application/o/gateway-web/',
          authorization_endpoint: 'http://authentik.internal/authorize',
          token_endpoint: 'http://authentik.internal/token',
          introspection_endpoint: 'http://authentik.internal/introspect',
          jwks_uri: 'http://authentik.internal/jwks',
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const oidc = service(
      'http://authentik.example/application/o/gateway-web/',
      'http://authentik.internal',
    );
    const url = await oidc.authorizationUrl({ state: 's', codeChallenge: 'c' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://authentik.internal/application/o/gateway-web/.well-known/openid-configuration',
    );
    expect(new URL(url).origin).toBe('http://authentik.example');
  });

  it('introspects through the in-cluster origin after discovery returned public URLs', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('openid-configuration')) {
        return {
          ok: true,
          json: async () => ({
            introspection_endpoint: 'http://authentik.example/introspect',
          }),
        };
      }
      expect(url).toBe('http://authentik.internal/introspect');
      return {
        ok: true,
        json: async () => ({ active: true, sub: 'user', groups: ['locaweb'] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const oidc = service(
      'http://authentik.example/application/o/gateway-web/',
      'http://authentik.internal',
    );
    await expect(oidc.introspect('tok')).resolves.toMatchObject({ sub: 'user' });
  });

  it('drops Authentik’s own groups — they are not tenants', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('openid-configuration')) {
          return {
            ok: true,
            json: async () => ({ introspection_endpoint: 'http://authentik.example/introspect' }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            active: true,
            sub: 'user',
            groups: ['authentik Admins', 'locaweb'],
          }),
        };
      }),
    );

    await expect(service().introspect('tok')).resolves.toEqual({
      sub: 'user',
      groups: ['locaweb'],
      role: 'viewer',
      expiresAt: undefined,
    });
  });
  it('names the caller from the profile scope, falling back to the username', async () => {
    const answer = (claims: Record<string, unknown>) =>
      vi.fn(async (input: string | URL) => {
        if (String(input).includes('openid-configuration')) {
          return {
            ok: true,
            json: async () => ({ introspection_endpoint: 'http://authentik.example/introspect' }),
          };
        }
        return { ok: true, json: async () => ({ active: true, sub: 'user', ...claims }) };
      });

    vi.stubGlobal(
      'fetch',
      answer({ name: 'Ana Souza', preferred_username: 'ana', email: 'a@x.io' }),
    );
    await expect(service().introspect('tok')).resolves.toMatchObject({
      name: 'Ana Souza',
      email: 'a@x.io',
    });

    vi.stubGlobal('fetch', answer({ name: '', preferred_username: 'ana' }));
    await expect(service().introspect('tok')).resolves.toMatchObject({ name: 'ana' });
  });
});
