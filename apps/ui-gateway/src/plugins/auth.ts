import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import createError from 'http-errors';
import { SealedJson } from '../lib/cipher.ts';
import { cookieAttributes } from '../lib/cookie.ts';
import type { Role } from '../services/oidc/service.ts';

/**
 * Who is calling, as one of the four credentials resolved it. The route hooks
 * read this; nothing below them parses a header again.
 */
export type Auth =
  | {
      kind: 'user';
      sub: string;
      name?: string;
      email?: string;
      tenants: string[];
      role: Role;
      accessToken: string;
    }
  | { kind: 'scheduler' }
  | { kind: 'run'; runKey: string }
  | { kind: 'none' };

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
      hmac: {
        <S extends object>(schema: S): { schema: S & { security: SecurityRequirement[] } };
        security: SecurityRequirement[];
      };
    };
  }
  interface FastifyRequest {
    auth: Auth;
  }
}

const BEARER = /^Bearer (.+)$/i;
const SESSION_COOKIE = 'oa_session';
const CSRF_HEADER = 'x-csrf-token';
const RUN_KEY_HEADER = 'X-Run-Key';
const HMAC_HEADER = 'X-Signature';

const securitySchemes = {
  cookieAuth: {
    type: 'apiKey' as const,
    in: 'cookie' as const,
    name: SESSION_COOKIE,
    description: 'Encrypted Authentik tokens. The browser never reads them.',
  },
  bearerAuth: {
    type: 'http' as const,
    scheme: 'bearer' as const,
    description: 'Access token issued by Authentik — MCP clients, and tests.',
  },
  schedulerKey: {
    type: 'http' as const,
    scheme: 'bearer' as const,
    description: 'The CronJob’s API key. Only starts a full_pipeline.',
  },
  runKey: {
    type: 'apiKey' as const,
    in: 'header' as const,
    name: RUN_KEY_HEADER,
    description: 'Credential from the Kafka message for this run — never on HTTP 202.',
  },
  hmac: {
    type: 'apiKey' as const,
    in: 'header' as const,
    name: HMAC_HEADER,
    description: 'HMAC of the webhook body, keyed by that (tenant, source) secret.',
  },
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

interface SessionPayload {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  csrf: string;
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Resolves the caller once per request, in the fixed order the dispatch table
 * declares: run key, then scheduler key, then a person. The first that matches
 * wins and the rest are not consulted — mixing them is what would let one
 * caller borrow another's authority.
 */
async function authPlugin(fastify: FastifyInstance) {
  const cookies = fastify.env.SESSION_COOKIE_KEY
    ? new SealedJson(fastify.env.SESSION_COOKIE_KEY)
    : undefined;

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

    const bearer = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (bearer) {
      if (await fastify.services.apiKeys.verify(bearer)) return { kind: 'scheduler' };
      return await asUser(bearer, request);
    }

    const cookie = cookies && readCookie(request, SESSION_COOKIE);
    if (cookie) {
      const session = cookies.open<SessionPayload>(cookie);
      if (session) {
        assertCsrf(request, session.csrf);
        return await asCookieUser(session, request, reply);
      }
    }

    return { kind: 'none' };
  }

  async function asUser(token: string, request: FastifyRequest): Promise<Auth> {
    if (!fastify.services.oidc.configured) return { kind: 'none' };
    try {
      const claims = await fastify.services.oidc.introspect(token);
      if (!claims) return { kind: 'none' };
      return {
        kind: 'user',
        sub: claims.sub,
        name: claims.name,
        email: claims.email,
        tenants: claims.groups,
        role: claims.role,
        accessToken: token,
      };
    } catch (err) {
      request.log.error({ err }, 'token introspection failed');
      throw createError.BadGateway('could not verify the token with the identity provider');
    }
  }

  /**
   * The cookie is the storage, so an expired access token is refreshed in
   * place rather than sending the browser back to login while the refresh
   * token is still live. A dead refresh is 401 — the front reenters login.
   */
  async function asCookieUser(
    session: SessionPayload,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Auth> {
    const live = await asUser(session.accessToken, request);
    if (live.kind === 'user') return live;
    if (!session.refreshToken || !cookies) return { kind: 'none' };

    let tokens: { accessToken: string; refreshToken?: string; idToken?: string } | undefined;
    try {
      tokens = await fastify.services.oidc.refresh(session.refreshToken);
    } catch (err) {
      request.log.error({ err }, 'token refresh failed');
      throw createError.BadGateway('could not refresh the token with the identity provider');
    }
    if (!tokens) return { kind: 'none' };

    const next: SessionPayload = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      idToken: tokens.idToken ?? session.idToken,
      csrf: session.csrf,
    };
    const attrs = cookieAttributes({
      secure: fastify.env.HTTPS_ENABLED,
      domain: fastify.env.SESSION_COOKIE_DOMAIN,
    });
    reply.header('set-cookie', `${SESSION_COOKIE}=${cookies.seal(next)}; HttpOnly; ${attrs}`);
    return await asUser(tokens.accessToken, request);
  }

  /**
   * Only the cookie pays this: a Bearer caller had to read the token to send
   * it, which a cross-site form cannot do.
   */
  function assertCsrf(request: FastifyRequest, expected: string): void {
    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return;
    }
    const presented = request.headers[CSRF_HEADER];
    if (presented !== expected) {
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
    if (request.auth.kind === 'user' && request.auth.role !== 'operator') {
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
