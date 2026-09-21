import { afterEach, describe, expect, it, vi } from 'vitest';
import { OidcService } from '../../../../src/services/oidc/service.ts';

function service(issuer = 'http://authentik.example/application/o/gateway-web/'): OidcService {
  return new OidcService({
    issuer,
    clientId: 'gateway-web',
    clientSecret: 'secret',
    redirectUri: 'http://gateway.example/auth/callback',
    introspectionCacheTtlMs: 5_000,
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
    expect(oidc.scopes.split(' ')).toContain('groups');
  });

  it('reuses an introspection answer inside the cache window', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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
      expiresAt: undefined,
    });
    await expect(oidc.introspect('tok')).resolves.toMatchObject({ sub: 'user' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('introspect'))).toHaveLength(
      1,
    );
  });

  it('treats a failed refresh as a dead session, not an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
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
});
