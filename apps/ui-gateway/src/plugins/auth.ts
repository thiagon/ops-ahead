import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import createError from 'http-errors';
import { type Auth, apiKeyScheme, bearerScheme, readBearer } from '../lib/auth.ts';
import { SealedJson } from '../lib/cipher.ts';
import { cookieAttributes, readCookie } from '../lib/cookie.ts';

const SESSION_COOKIE = 'oa_session';
const CSRF_HEADER = 'x-csrf-token';
const RUN_KEY_HEADER = 'X-Run-Key';
const HMAC_HEADER = 'X-Signature';
const WRITER_ROLE = 'operator';

const securitySchemes = {
  cookieAuth: apiKeyScheme({
    in: 'cookie',
    name: SESSION_COOKIE,
    description: 'Encrypted Authentik tokens. The browser never reads them.',
  }),
  bearerAuth: bearerScheme('Access token issued by Authentik — MCP clients, and tests.'),
  schedulerKey: bearerScheme('The CronJob’s API key. Only starts a full_pipeline.'),
  runKey: apiKeyScheme({
    in: 'header',
    name: RUN_KEY_HEADER,
    description: 'Credential from the Kafka message for this run — never on HTTP 202.',
  }),
  hmac: apiKeyScheme({
    in: 'header',
    name: HMAC_HEADER,
    description: 'HMAC of the webhook body, keyed by that (tenant, source) secret.',
  }),
};

type SecurityRequirement = Record<string, string[]>;

type Gate = {
  <S extends object>(
    schema: S,
  ): {
    preHandler: preHandlerAsyncHookHandler;
    schema: S & { security: SecurityRequirement[] };
  };
  security: SecurityRequirement[];
};

function gate(preHandler: preHandlerAsyncHookHandler, security: SecurityRequirement[]): Gate {
  const apply = <S extends object>(schema: S) => ({
    preHandler,
    schema: { ...schema, security },
  });
  return Object.assign(apply, { security });
}

function documented(security: SecurityRequirement[]) {
  const apply = <S extends object>(schema: S) => ({ schema: { ...schema, security } });
  return Object.assign(apply, { security });
}

interface SealedSession {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  csrf: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Who may call a route, as one object: the preHandler and the OpenAPI
     * schemes it documents. A route names the access; it does not pick a
     * hook from one place and a scheme from another.
     */
    auth: {
      schemes: typeof securitySchemes;
      user: Gate;
      tenant: Gate;
      operator: Gate;
      schedulerOrRun: Gate;
      run: Gate;
      hmac: ReturnType<typeof documented>;
    };
  }
  interface FastifyRequest {
    auth: Auth;
  }
}

/**
 * Resolves the caller once per request, in a fixed order: run key, then
 * scheduler key, then a person. The first that matches wins and the rest are
 * not consulted — mixing them is what would let one caller borrow another's
 * authority.
 */
async function authPlugin(fastify: FastifyInstance) {
  const cookies = fastify.env.SESSION_COOKIE_KEY
    ? new SealedJson(fastify.env.SESSION_COOKIE_KEY)
    : undefined;
  const attributes = cookieAttributes({
    secure: fastify.env.HTTPS_ENABLED,
    domain: fastify.env.SESSION_COOKIE_DOMAIN,
  });

  // Declared without a value so each request owns its own; the onRequest hook
  // below is what sets it.
  fastify.decorateRequest('auth');

  fastify.addHook('onRequest', async (request, reply) => {
    request.auth = await resolve(request, reply);
  });

  async function resolve(request: FastifyRequest, reply: FastifyReply): Promise<Auth> {
    // The boundary plugins can be mounted without the service container (the
    // webhook path does exactly that), and no credential is resolvable then.
    if (!fastify.hasDecorator('services')) return { kind: 'none' };

    const runKey = request.headers['x-run-key'];
    if (typeof runKey === 'string' && runKey.length > 0) {
      return { kind: 'run', runKey };
    }

    const bearer = readBearer(request.headers.authorization);
    if (bearer) {
      if (await fastify.services.apiKeys.verify(bearer)) return { kind: 'scheduler' };
      return await asUser(bearer, request);
    }

    const cookie = cookies && readCookie(request.headers.cookie, SESSION_COOKIE);
    if (cookie) {
      const session = cookies.open<SealedSession>(cookie);
      if (session) {
        assertCsrf(request, session.csrf);
        return await asCookieUser(session, request, reply);
      }
    }

    return { kind: 'none' };
  }

  async function asUser(token: string, request: FastifyRequest): Promise<Auth> {
    try {
      const identity = await fastify.services.session.identify(token);
      if (!identity) return { kind: 'none' };
      return { kind: 'user', ...identity, accessToken: token };
    } catch (err) {
      request.log.error({ err }, 'token introspection failed');
      throw createError.BadGateway('could not verify the token with the identity provider');
    }
  }

  /**
   * The cookie is the storage, so an expired access token is refreshed in
   * place rather than sending the browser back to login while the refresh
   * token is still live. A dead refresh is a stranger again.
   */
  async function asCookieUser(
    session: SealedSession,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Auth> {
    const live = await asUser(session.accessToken, request);
    if (live.kind === 'user') return { ...live, idToken: session.idToken };
    if (!session.refreshToken || !cookies) return { kind: 'none' };

    let tokens: { accessToken: string; refreshToken?: string; idToken?: string } | undefined;
    try {
      tokens = await fastify.oidc.refresh(session.refreshToken);
    } catch (err) {
      request.log.error({ err }, 'token refresh failed');
      throw createError.BadGateway('could not refresh the token with the identity provider');
    }
    if (!tokens) return { kind: 'none' };

    const next: SealedSession = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      idToken: tokens.idToken ?? session.idToken,
      csrf: session.csrf,
    };
    reply.header('set-cookie', `${SESSION_COOKIE}=${cookies.seal(next)}; HttpOnly; ${attributes}`);
    const refreshed = await asUser(tokens.accessToken, request);
    if (refreshed.kind !== 'user') return refreshed;
    return { ...refreshed, idToken: next.idToken };
  }

  /**
   * Only the cookie pays this: a Bearer caller had to read the token to send
   * it, which a cross-site form cannot do.
   */
  function assertCsrf(request: FastifyRequest, expected: string): void {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    if (request.headers[CSRF_HEADER] !== expected) {
      throw createError.Forbidden(`missing or invalid ${CSRF_HEADER} header`);
    }
  }

  const requireUser: preHandlerAsyncHookHandler = async request => {
    if (request.auth.kind !== 'user') {
      throw createError.Unauthorized('this endpoint needs a logged-in caller');
    }
  };

  const requireTenant: preHandlerAsyncHookHandler = async request => {
    const auth = request.auth;
    if (auth.kind !== 'user') {
      throw createError.Unauthorized('this endpoint needs a logged-in caller');
    }
    const { tenant } = request.params as { tenant?: string };
    if (!tenant) return;
    if (!auth.tenants.includes(tenant)) {
      throw createError.Forbidden('this caller does not act for that tenant');
    }
    await fastify.services.tenants.ensure(tenant);
  };

  const requireOperator: preHandlerAsyncHookHandler = async function (request, reply) {
    await requireTenant.call(this, request, reply);
    if (request.auth.kind === 'user' && request.auth.role !== WRITER_ROLE) {
      throw createError.Forbidden('this caller can read this tenant but not change it');
    }
  };

  const requireSchedulerOrRun: preHandlerAsyncHookHandler = async request => {
    if (request.auth.kind !== 'scheduler' && request.auth.kind !== 'run') {
      throw createError.Unauthorized('this endpoint needs a scheduler key or a run key');
    }
  };

  const requireRun: preHandlerAsyncHookHandler = async request => {
    if (request.auth.kind !== 'run') {
      throw createError.Unauthorized('this endpoint needs a run key');
    }
  };

  fastify.decorate('auth', {
    schemes: securitySchemes,
    user: gate(requireUser, [{ cookieAuth: [] }, { bearerAuth: [] }]),
    tenant: gate(requireTenant, [{ cookieAuth: [] }, { bearerAuth: [] }]),
    operator: gate(requireOperator, [{ cookieAuth: [] }, { bearerAuth: [] }]),
    schedulerOrRun: gate(requireSchedulerOrRun, [{ schedulerKey: [] }, { runKey: [] }]),
    run: gate(requireRun, [{ runKey: [] }]),
    hmac: documented([{ hmac: [] }]),
  });
}

// `services` is read at request time, not at registration: declaring it as a
// dependency would force the whole service container into any app that only
// wants the HTTP boundary plugins.
export default fp(authPlugin, { name: 'auth', dependencies: ['env'] });
