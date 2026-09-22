import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authIdentitySchema } from '#lib/auth.ts';

export function registerAuthRoutes(app: FastifyInstance): void {
  const session = app.services.session;
  const typed = app.withTypeProvider<ZodTypeProvider>();

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
      const started = await session.begin(request.query.next);
      if (!started) {
        return reply
          .status(503)
          .send({ error: 'AuthNotConfigured', message: 'no identity provider is configured' });
      }
      return reply.header('set-cookie', started.cookie).redirect(started.location, 302);
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
      const done = await session.complete({
        code: request.query.code,
        state: request.query.state,
        cookieHeader: request.headers.cookie,
      });
      return reply.header('set-cookie', done.cookies).redirect(done.location, 302);
    },
  );

  typed.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the token, clear the cookie, and end the provider session',
        security: app.auth.user.security,
        response: { 200: z.object({ redirect: z.string().nullable() }) },
      },
    },
    async (request, reply) => {
      const ended = await session.end(request.auth);
      return reply
        .header('set-cookie', ended.cookies)
        .status(200)
        .send({ redirect: ended.redirect });
    },
  );

  typed.get(
    '/auth/me',
    app.auth.user({
      tags: ['auth'],
      summary: 'Who the caller is and which tenants they operate',
      description:
        'Read from the token at Authentik, not from a table here — the gateway keeps no record of a person.',
      response: { 200: authIdentitySchema },
    }),
    async request => authIdentitySchema.parse(request.auth),
  );

  // RFC 9728: what an MCP client reads after a 401 to find the authorization
  // server it should go to.
  typed.get('/.well-known/oauth-protected-resource', { schema: { hide: true } }, async () => ({
    resource: app.env.PUBLIC_URL,
    authorization_servers: [app.oidc.authorizationServer(app.env.AUTHENTIK_MCP_CLIENT_ID)],
    bearer_methods_supported: ['header'],
    scopes_supported: app.oidc.scopes.split(' '),
  }));
}
