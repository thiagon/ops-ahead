import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import createError from 'http-errors';
import { z } from 'zod';
import { SealedJson } from '../../lib/cipher.ts';
import { cookieAttributes } from '../../lib/cookie.ts';

/**
 * The PKCE verifier and the state have to survive the round trip to Authentik
 * without a session to hold them, so they ride in a short-lived cookie of
 * their own, cleared the moment the callback spends it.
 */
const FLOW_COOKIE = 'oa_auth_flow';
const FLOW_MAX_AGE_SECONDS = 600;
const SESSION_COOKIE = 'oa_session';
const CSRF_COOKIE = 'oa_csrf';

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

async function authRoutes(app: FastifyInstance): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const cookieOpts = {
    secure: app.env.HTTPS_ENABLED,
    domain: app.env.SESSION_COOKIE_DOMAIN,
  };
  const cookies = app.env.SESSION_COOKIE_KEY
    ? new SealedJson(app.env.SESSION_COOKIE_KEY)
    : undefined;

  typed.get(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Start the login redirect to Authentik',
        querystring: z.object({ next: z.string().optional() }),
        response: { 302: z.null(), 503: z.object({ error: z.string(), message: z.string() }) },
      },
    },
    async (request, reply) => {
      if (!app.services.oidc.configured || !cookies) {
        return reply
          .status(503)
          .send({ error: 'AuthNotConfigured', message: 'no identity provider is configured' });
      }

      const verifier = base64url(randomBytes(32));
      const state = base64url(randomBytes(16));
      const url = await app.services.oidc.authorizationUrl({
        state,
        codeChallenge: challengeFor(verifier),
      });

      // Only a path is carried back, never a full URL: an absolute `next`
      // would make this endpoint an open redirect.
      const next = request.query.next?.startsWith('/') ? request.query.next : undefined;

      return reply
        .header(
          'set-cookie',
          `${FLOW_COOKIE}=${encodeURIComponent(JSON.stringify({ verifier, state, next }))}; HttpOnly; ${cookieAttributes({ ...cookieOpts, maxAgeSeconds: FLOW_MAX_AGE_SECONDS })}`,
        )
        .redirect(url, 302);
    },
  );

  typed.get(
    '/auth/callback',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange the authorization code and set the session cookie',
        querystring: z.object({ code: z.string().min(1), state: z.string().min(1) }),
        response: { 302: z.null() },
      },
    },
    async (request, reply) => {
      if (!cookies) throw createError.ServiceUnavailable('no identity provider is configured');

      const raw = request.headers.cookie
        ?.split(';')
        .map(part => part.trim())
        .find(part => part.startsWith(`${FLOW_COOKIE}=`))
        ?.slice(FLOW_COOKIE.length + 1);
      if (!raw) throw createError.BadRequest('the login flow did not start here');

      const flow = JSON.parse(decodeURIComponent(raw)) as {
        verifier: string;
        state: string;
        next?: string;
      };
      if (flow.state !== request.query.state) {
        throw createError.BadRequest('state does not match the one this flow started with');
      }

      const tokens = await app.services.oidc.exchangeCode(request.query.code, flow.verifier);
      const csrf = base64url(randomBytes(16));
      const sealed = cookies.seal({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        csrf,
      });

      return reply
        .header('set-cookie', [
          `${FLOW_COOKIE}=; HttpOnly; ${cookieAttributes({ ...cookieOpts, maxAgeSeconds: 0 })}`,
          `${SESSION_COOKIE}=${sealed}; HttpOnly; ${cookieAttributes(cookieOpts)}`,
          // Readable by the front on purpose: it has to echo the value back
          // in the header, which is what a cross-site caller cannot do.
          `${CSRF_COOKIE}=${csrf}; ${cookieAttributes(cookieOpts)}`,
        ])
        .redirect(`${app.env.FRONTEND_ORIGIN.replace(/\/$/, '')}${flow.next ?? '/'}`, 302);
    },
  );

  typed.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the token at Authentik and clear the cookie',
        security: app.auth.user.security,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      if (request.auth.kind === 'user') {
        await app.services.oidc.revoke(request.auth.accessToken);
      }
      return reply
        .header('set-cookie', [
          `${SESSION_COOKIE}=; HttpOnly; ${cookieAttributes({ ...cookieOpts, maxAgeSeconds: 0 })}`,
          `${CSRF_COOKIE}=; ${cookieAttributes({ ...cookieOpts, maxAgeSeconds: 0 })}`,
        ])
        .status(204)
        .send(null);
    },
  );

  typed.get(
    '/auth/me',
    app.auth.user({
      tags: ['auth'],
      summary: 'Who the caller is and which tenants they operate',
      description:
        'Read from the token at Authentik, not from a table here — the gateway keeps no record of a person.',
      response: {
        200: z
          .object({ sub: z.string(), tenants: z.array(z.string()) })
          .meta({ id: 'AuthIdentity' }),
      },
    }),
    async request => {
      const auth = request.auth as Extract<typeof request.auth, { kind: 'user' }>;
      return { sub: auth.sub, tenants: auth.tenants };
    },
  );

  // RFC 9728: what an MCP client reads after a 401 to find the authorization
  // server it should go to.
  typed.get('/.well-known/oauth-protected-resource', { schema: { hide: true } }, async () => ({
    resource: app.env.PUBLIC_URL,
    authorization_servers: [app.services.oidc.authorizationServer(app.env.AUTHENTIK_MCP_CLIENT_ID)],
    bearer_methods_supported: ['header'],
    scopes_supported: app.services.oidc.scopes.split(' '),
  }));
}

export default fp(authRoutes, { name: 'auth-routes', dependencies: ['env', 'services', 'auth'] });
