import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { OidcClient, TokenClaims } from '../../../../src/lib/oidc.ts';
import { SessionService } from '../../../../src/services/session/service.ts';

function session(claims: TokenClaims | undefined): SessionService {
  const oidc = {
    configured: true,
    introspect: async () => claims,
  } as unknown as OidcClient;
  return new SessionService(
    oidc,
    undefined,
    { secure: false, frontendOrigin: 'http://ui.example', publicUrl: 'http://gw.example' },
    { error() {} } as unknown as FastifyBaseLogger,
  );
}

const base: TokenClaims = { sub: 'user', groups: [] };

describe('SessionService.identify', () => {
  it.each([
    ['operator', 'operator'],
    ['viewer', 'viewer'],
    ['admin', 'viewer'],
    [undefined, 'viewer'],
  ])('reads ops_ahead_role %s as %s', async (roleClaim, role) => {
    await expect(session({ ...base, roleClaim }).identify('tok')).resolves.toMatchObject({ role });
  });

  it('drops Authentik’s own groups — they are not tenants', async () => {
    await expect(
      session({ ...base, groups: ['authentik Admins', 'locaweb'] }).identify('tok'),
    ).resolves.toMatchObject({ tenants: ['locaweb'], role: 'viewer' });
  });
});
