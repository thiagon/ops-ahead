import { afterEach, describe, expect, it, vi } from 'vitest';
import { OidcClient } from '../../../src/lib/oidc.ts';

function client(
  issuer = 'http://authentik.example/application/o/gateway-web/',
  internalOrigin?: string,
): OidcClient {
  return new OidcClient({
    issuer,
    clientId: 'gateway-web',
    clientSecret: 'secret',
    redirectUri: 'http://gateway.example/auth/callback',
    introspectionCacheTtlMs: 5_000,
    internalOrigin,
  });
}

describe('OidcClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('points MCP clients at the public Authentik app', () => {
    expect(client().authorizationServer('gateway-mcp')).toBe(
      'http://authentik.example/application/o/gateway-mcp/',
    );
  });

  it('leaves an issuer it cannot rewrite alone', () => {
    expect(client('http://authentik.example/').authorizationServer('gateway-mcp')).toBe(
      'http://authentik.example/',
    );
  });

  it('requests the scopes the token is issued with', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ authorization_endpoint: 'http://authentik.example/authorize' }),
      })),
    );

    const oidc = client();
    const url = await oidc.authorizationUrl({ state: 's', codeChallenge: 'c' });

    expect(new URL(url).searchParams.get('scope')).toBe(oidc.scopes);
    expect(oidc.scopes.split(' ')).toContain('groups');
  });

  it('returns to the app from end-session only when it can send the id token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ end_session_endpoint: 'http://authentik.example/end-session' }),
      })),
    );

    const oidc = client();
    const hinted = new URL(
      (await oidc.endSessionUrl({
        idToken: 'id-token',
        postLogoutRedirectUri: 'http://ui.example/',
      })) ?? '',
    );
    expect(hinted.searchParams.get('id_token_hint')).toBe('id-token');
    expect(hinted.searchParams.get('post_logout_redirect_uri')).toBe('http://ui.example/');

    const plain = new URL(
      (await oidc.endSessionUrl({ postLogoutRedirectUri: 'http://ui.example/' })) ?? '',
    );
    expect(plain.origin + plain.pathname).toBe('http://authentik.example/end-session');
    expect(plain.searchParams.has('post_logout_redirect_uri')).toBe(false);
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

    const oidc = client();
    await expect(oidc.introspect('tok')).resolves.toEqual({
      sub: 'user',
      groups: ['locaweb'],
      name: undefined,
      email: undefined,
      roleClaim: undefined,
      expiresAt: undefined,
    });
    await expect(oidc.introspect('tok')).resolves.toMatchObject({ sub: 'user' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('introspect'))).toHaveLength(
      1,
    );
  });

  it('returns the provider claims without deciding what they mean', async () => {
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
          json: async () => ({
            active: true,
            sub: 'user',
            groups: ['authentik Admins', 'locaweb'],
            ops_ahead_role: 'admin',
          }),
        };
      }),
    );

    await expect(client().introspect('tok')).resolves.toMatchObject({
      groups: ['authentik Admins', 'locaweb'],
      roleClaim: 'admin',
    });
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

    await expect(client().refresh('stale')).resolves.toBeUndefined();
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

    const oidc = client(
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

    const oidc = client(
      'http://authentik.example/application/o/gateway-web/',
      'http://authentik.internal',
    );
    await expect(oidc.introspect('tok')).resolves.toMatchObject({ sub: 'user' });
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
    await expect(client().introspect('tok')).resolves.toMatchObject({
      name: 'Ana Souza',
      email: 'a@x.io',
    });

    vi.stubGlobal('fetch', answer({ name: '', preferred_username: 'ana' }));
    await expect(client().introspect('tok')).resolves.toMatchObject({ name: 'ana' });
  });
});
