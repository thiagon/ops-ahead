import { createHash, randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import createError from 'http-errors';
import type { AuthIdentity } from '../../lib/auth.ts';
import type { SealedJson } from '../../lib/cipher.ts';
import { cookieAttributes, readCookie } from '../../lib/cookie.ts';
import type { OidcClient } from '../../lib/oidc.ts';

const FLOW_COOKIE = 'oa_auth_flow';
const FLOW_MAX_AGE_SECONDS = 600;
const SESSION_COOKIE = 'oa_session';
const CSRF_COOKIE = 'oa_csrf';

interface SessionOptions {
  secure: boolean;
  domain?: string;
  frontendOrigin: string;
  publicUrl: string;
}

interface FlowCookie {
  verifier: string;
  state: string;
  next: string;
}

/**
 * The browser session in front of Authentik. The route maps the HTTP call;
 * where login may return, and where logout sends the browser, is decided here.
 */
export class SessionService {
  #oidc: OidcClient;
  #cookies: SealedJson | undefined;
  #options: SessionOptions;
  #log: FastifyBaseLogger;

  constructor(
    oidc: OidcClient,
    cookies: SealedJson | undefined,
    options: SessionOptions,
    log: FastifyBaseLogger,
  ) {
    this.#oidc = oidc;
    this.#cookies = cookies;
    this.#options = options;
    this.#log = log;
  }

  /**
   * Who the token is, in the gateway's terms. Authentik's own groups are not
   * tenants. Only an explicit `operator` writes; a missing or other claim reads.
   */
  async identify(token: string): Promise<AuthIdentity | undefined> {
    if (!this.#oidc.configured) return undefined;
    const claims = await this.#oidc.introspect(token);
    if (!claims) return undefined;
    return {
      sub: claims.sub,
      name: claims.name,
      email: claims.email,
      tenants: claims.groups.filter(group => !group.startsWith('authentik ')),
      role: claims.roleClaim === 'operator' ? 'operator' : 'viewer',
    };
  }

  /**
   * Where the callback sends the browser. A bare path is the front's; an
   * absolute URL is honored only on the front's or the gateway's own origin,
   * so this endpoint never becomes an open redirect.
   */
  resolveNext(next: string | undefined): string {
    const home = new URL(this.#options.frontendOrigin);
    const gateway = new URL(this.#options.publicUrl);
    if (!next) return home.toString();
    if (next.startsWith('/') && !next.startsWith('//')) return new URL(next, home).toString();
    try {
      const target = new URL(next);
      if (target.origin === home.origin || target.origin === gateway.origin) {
        return target.toString();
      }
    } catch {
      // Not a URL: fall through to the front's home.
    }
    return home.toString();
  }

  async begin(next: string | undefined): Promise<{ cookie: string; location: string } | undefined> {
    if (!this.#oidc.configured || !this.#cookies) return undefined;

    const verifier = base64url(randomBytes(32));
    const state = base64url(randomBytes(16));
    const location = await this.#oidc.authorizationUrl({
      state,
      codeChallenge: challengeFor(verifier),
    });
    const flow: FlowCookie = { verifier, state, next: this.resolveNext(next) };
    return {
      cookie: `${FLOW_COOKIE}=${encodeURIComponent(JSON.stringify(flow))}; HttpOnly; ${this.#attrs(FLOW_MAX_AGE_SECONDS)}`,
      location,
    };
  }

  async complete(input: {
    code: string;
    state: string;
    cookieHeader: string | undefined;
  }): Promise<{ cookies: string[]; location: string }> {
    if (!this.#cookies) throw createError.ServiceUnavailable('no identity provider is configured');
    const flowCookie = readCookie(input.cookieHeader, FLOW_COOKIE);
    if (!flowCookie) throw createError.BadRequest('the login flow did not start here');

    const flow = JSON.parse(flowCookie) as FlowCookie;
    if (flow.state !== input.state) {
      throw createError.BadRequest('state does not match the one this flow started with');
    }

    const tokens = await this.#oidc.exchangeCode(input.code, flow.verifier);
    const csrf = base64url(randomBytes(16));
    const sealed = this.#cookies.seal({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      csrf,
    });

    return {
      cookies: [
        `${FLOW_COOKIE}=; HttpOnly; ${this.#attrs(0)}`,
        `${SESSION_COOKIE}=${sealed}; HttpOnly; ${this.#attrs()}`,
        // Readable by the front on purpose: it has to echo the value back
        // in the header, which is what a cross-site caller cannot do.
        `${CSRF_COOKIE}=${csrf}; ${this.#attrs()}`,
      ],
      location: flow.next,
    };
  }

  async end(auth: {
    kind: string;
    accessToken?: string;
    idToken?: string;
  }): Promise<{ cookies: string[]; redirect: string | null }> {
    let redirect: string | undefined;
    if (auth.kind === 'user' && auth.accessToken) {
      await this.#oidc.revoke(auth.accessToken);
      try {
        redirect = await this.#oidc.endSessionUrl({
          idToken: auth.idToken,
          postLogoutRedirectUri: new URL('/', this.#options.frontendOrigin).toString(),
        });
      } catch (err) {
        this.#log.error({ err }, 'could not build the end-session url');
      }
    }
    return {
      cookies: [
        `${SESSION_COOKIE}=; HttpOnly; ${this.#attrs(0)}`,
        `${CSRF_COOKIE}=; ${this.#attrs(0)}`,
      ],
      redirect: redirect ?? null,
    };
  }

  #attrs(maxAgeSeconds?: number): string {
    return cookieAttributes({
      secure: this.#options.secure,
      domain: this.#options.domain,
      maxAgeSeconds,
    });
  }
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}
