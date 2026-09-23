import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { OidcClient } from '../lib/oidc.ts';

declare module 'fastify' {
  interface FastifyInstance {
    oidc: OidcClient;
  }
}

async function oidcPlugin(fastify: FastifyInstance) {
  // Whoever builds the app may hand in its own client — a test double.
  // Only the default wiring talks to the provider.
  if (fastify.hasDecorator('oidc')) return;

  fastify.decorate(
    'oidc',
    new OidcClient({
      issuer: fastify.env.AUTHENTIK_ISSUER,
      clientId: fastify.env.AUTHENTIK_CLIENT_ID,
      clientSecret: fastify.env.AUTHENTIK_CLIENT_SECRET,
      redirectUri: `${fastify.env.PUBLIC_URL.replace(/\/$/, '')}/auth/callback`,
      introspectionCacheTtlMs: fastify.env.INTROSPECTION_CACHE_TTL_MS,
      internalOrigin: fastify.env.AUTHENTIK_INTERNAL_ORIGIN || undefined,
    }),
  );
}

export default fp(oidcPlugin, { name: 'oidc', dependencies: ['env'] });
