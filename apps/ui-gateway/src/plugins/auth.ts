import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import createError from 'http-errors';
import { type Auth, NoAuth, RunAuth, SchedulerAuth, UserAuth } from '../lib/auth.ts';

const CSRF_HEADER = 'x-csrf-token';
const RUN_KEY_HEADER = 'X-Run-Key';
const HMAC_HEADER = 'X-Signature';
const SESSION_COOKIE = 'oa_session';
const WRITER_ROLE = 'operator';

const securitySchemes = {
  cookieAuth: apiKeyScheme({
    in: 'cookie',
    name: SESSION_COOKIE,
    description: 'Encrypted Authentik tokens. The browser never reads them.',
  }),
  bearerAuth: bearerScheme('Access token issued by Authentik — MCP clients, and tests.'),
  schedulerKey: bearerScheme('The CronJob’s API key.'),
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

type CheckName = 'user' | 'tenant' | 'writer' | 'scheduler' | 'run';

type SecurityRequirement = Record<string, string[]>;

type AuthCheck = preHandlerAsyncHookHandler & { security: SecurityRequirement[] };

type Gate = {
  <S extends object>(
    schema: S,
  ): {
    preHandler: preHandlerAsyncHookHandler;
    schema: S & { security: SecurityRequirement[] };
  };
  security: SecurityRequirement[];
};

function check(preHandler: preHandlerAsyncHookHandler, security: SecurityRequirement[]): AuthCheck {
  return Object.assign(preHandler, { security });
}

function isCheck(fn: AuthCheck | readonly AuthCheck[]): fn is AuthCheck {
  return !Array.isArray(fn);
}

function gate(preHandler: AuthCheck): Gate {
  const apply = <S extends object>(schema: S) => ({
    preHandler,
    schema: { ...schema, security: preHandler.security },
  });
  return Object.assign(apply, { security: preHandler.security });
}

/**
 * A list passes when any check does. A list inside it passes when every check
 * does — the same pairing a route's OpenAPI `security` array uses. `and` stops
 * at the first failure; `or` returns the last one.
 */
function compose(
  functions: ReadonlyArray<AuthCheck | readonly AuthCheck[]>,
  relation: 'or' | 'and',
  nested = false,
): AuthCheck {
  if (functions.length === 0) throw new Error('Missing auth functions');
  const parts = functions.map((fn): AuthCheck => {
    if (isCheck(fn)) return fn;
    if (nested) throw new TypeError('Nesting sub-arrays is not supported');
    return compose(fn, relation === 'or' ? 'and' : 'or', true);
  });

  const security =
    relation === 'or'
      ? parts.flatMap(part => part.security)
      : parts.reduce<SecurityRequirement[]>((acc, part) => {
          if (part.security.length === 0) return acc;
          if (acc.length === 0) return part.security;
          return acc.flatMap(left => part.security.map(right => ({ ...left, ...right })));
        }, []);

  const preHandler: preHandlerAsyncHookHandler = async function (request, reply) {
    if (relation === 'and') {
      for (const part of parts) await part.call(this, request, reply);
      return;
    }
    let error: unknown;
    for (const part of parts) {
      try {
        await part.call(this, request, reply);
        return;
      } catch (err) {
        error = err;
      }
    }
    throw error;
  };

  return check(preHandler, security);
}

function documented(security: SecurityRequirement[]) {
  const apply = <S extends object>(schema: S) => ({ schema: { ...schema, security } });
  return Object.assign(apply, { security });
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Who may call a route, as one object: the preHandler and the OpenAPI
     * schemes it documents. A route names the access; it does not pick a
     * hook from one place and a scheme from another.
     */
    auth: {
      (
        checks: ReadonlyArray<CheckName | readonly CheckName[]>,
        options?: { relation?: 'or' | 'and' },
      ): Gate;
      schemes: typeof securitySchemes;
      user: Gate;
      tenant: Gate;
      operator: Gate;
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
  // Declared without a value so each request owns its own; the onRequest hook
  // below is what sets it.
  fastify.decorateRequest('auth');

  fastify.addHook('onRequest', async (request, reply) => {
    request.auth = await resolve(request, reply);
  });

  async function resolve(request: FastifyRequest, reply: FastifyReply): Promise<Auth> {
    // The boundary plugins can be mounted without the service container (the
    // webhook path does exactly that), and no credential is resolvable then.
    if (!fastify.hasDecorator('services')) return new NoAuth();

    const runKey = request.headers['x-run-key'];
    if (typeof runKey === 'string' && runKey.length > 0) return new RunAuth(runKey);

    const bearer = readBearer(request.headers.authorization);
    if (bearer) {
      if (await fastify.services.apiKeys.verify(bearer)) return new SchedulerAuth();
      return (await fastify.services.session.userFrom(bearer)) ?? new NoAuth();
    }

    const resumed = await fastify.services.session.resume({
      cookieHeader: request.headers.cookie,
      method: request.method,
      csrfHeader:
        typeof request.headers[CSRF_HEADER] === 'string' ? request.headers[CSRF_HEADER] : undefined,
      csrfHeaderName: CSRF_HEADER,
    });
    if (resumed?.setCookie) reply.header('set-cookie', resumed.setCookie);
    return resumed?.user ?? new NoAuth();
  }

  const user = check(
    async request => {
      if (!(request.auth instanceof UserAuth)) {
        throw createError.Unauthorized('this endpoint needs a logged-in caller');
      }
    },
    [{ cookieAuth: [] }, { bearerAuth: [] }],
  );

  const tenant = check(async request => {
    if (!(request.auth instanceof UserAuth)) {
      throw createError.Unauthorized('this endpoint needs a logged-in caller');
    }
    const { tenant } = request.params as { tenant?: string };
    if (!tenant) return;
    if (!request.auth.tenants.includes(tenant)) {
      throw createError.Forbidden('this caller does not act for that tenant');
    }
    await fastify.services.tenants.ensure(tenant);
  }, []);

  const writer = check(async request => {
    if (!(request.auth instanceof UserAuth)) {
      throw createError.Unauthorized('this endpoint needs a logged-in caller');
    }
    if (request.auth.role !== WRITER_ROLE) {
      throw createError.Forbidden('this caller can read this tenant but not change it');
    }
  }, []);

  const scheduler = check(
    async request => {
      if (!(request.auth instanceof SchedulerAuth)) {
        throw createError.Unauthorized('this endpoint needs a scheduler key');
      }
    },
    [{ schedulerKey: [] }],
  );

  const run = check(
    async request => {
      if (!(request.auth instanceof RunAuth)) {
        throw createError.Unauthorized('this endpoint needs a run key');
      }
    },
    [{ runKey: [] }],
  );

  const owned = { user, tenant, writer, scheduler, run };

  function allow(
    names: ReadonlyArray<CheckName | readonly CheckName[]>,
    options?: { relation?: 'or' | 'and' },
  ): Gate {
    const relation = options?.relation ?? 'or';
    if (relation !== 'or' && relation !== 'and') {
      throw new Error("The value of options.relation should be one of ['or', 'and']");
    }
    const checks = names.map(name =>
      typeof name === 'string' ? owned[name] : name.map(part => owned[part]),
    );
    return gate(compose(checks, relation));
  }

  fastify.decorate(
    'auth',
    Object.assign(allow, {
      schemes: securitySchemes,
      user: gate(user),
      tenant: gate(compose([user, tenant], 'and')),
      operator: gate(compose([user, tenant, writer], 'and')),
      run: gate(run),
      hmac: documented([{ hmac: [] }]),
    }),
  );
}

function apiKeyScheme<I extends 'cookie' | 'header'>(input: {
  in: I;
  name: string;
  description: string;
}) {
  return {
    type: 'apiKey' as const,
    in: input.in,
    name: input.name,
    description: input.description,
  };
}

function bearerScheme(description: string) {
  return { type: 'http' as const, scheme: 'bearer' as const, description };
}

const BEARER = /^Bearer (.+)$/i;

function readBearer(authorization: string | undefined): string | undefined {
  return BEARER.exec(authorization ?? '')?.[1];
}

// `services` is read at request time, not at registration: declaring it as a
// dependency would force the whole service container into any app that only
// wants the HTTP boundary plugins.
export default fp(authPlugin, { name: 'auth' });
