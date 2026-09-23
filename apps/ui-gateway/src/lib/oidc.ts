import createError from 'http-errors';

/**
 * The subset of the OIDC discovery document the gateway spends. Read once and
 * kept: a realm does not move its endpoints while the process lives.
 */
export interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  introspection_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri: string;
}

/** What introspection says about a token that is still live. */
export interface TokenClaims {
  sub: string;
  /** Group names as the provider sent them. */
  groups: string[];
  /** Display name from the `profile` scope, falling back to the username. */
  name?: string;
  email?: string;
  /** The `ops_ahead_role` claim, verbatim. */
  roleClaim?: string;
  expiresAt?: number;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  introspectionCacheTtlMs: number;
  /** In-cluster origin of the issuer host. Empty: fetch the issuer as written. */
  internalOrigin?: string;
}

interface CacheEntry {
  claims: TokenClaims | undefined;
  readAt: number;
}

/**
 * Talks to Authentik for the three things the gateway cannot decide alone:
 * where to send someone to log in, what a code is worth, and whether a token
 * is still good.
 *
 * Introspection rather than offline JWKS validation is what makes revocation
 * immediate — the price is one call per request, bounded by a short cache
 * whose TTL is the delay on revoking someone.
 */
export class OidcClient {
  /** Scopes this client requests so the token carries profile, email and groups. */
  static readonly SCOPES = 'openid profile email groups';

  #config: OidcConfig;
  #metadata?: Promise<ProviderMetadata>;
  #cache = new Map<string, CacheEntry>();

  constructor(config: OidcConfig) {
    this.#config = config;
  }

  get configured(): boolean {
    return this.#config.issuer !== '' && this.#config.clientId !== '';
  }

  get scopes(): string {
    return OidcClient.SCOPES;
  }

  /**
   * The authorization server an MCP client should register against. Two
   * Authentik apps share a host; the public one is what Dynamic Client
   * Registration hits.
   */
  authorizationServer(mcpClientId: string): string {
    const { issuer } = this.#config;
    if (!issuer) return issuer;
    const base = this.#trailingSlash(issuer);
    if (!mcpClientId) return base;
    return base.replace(/\/application\/o\/[^/]+\/$/, `/application/o/${mcpClientId}/`);
  }

  async metadata(): Promise<ProviderMetadata> {
    this.#metadata ??= this.#discover();
    try {
      return await this.#metadata;
    } catch (err) {
      // A failed discovery must not poison the process: the realm may simply
      // have been slower to start than the gateway.
      this.#metadata = undefined;
      throw err;
    }
  }

  /** Where the browser goes to log in, with the PKCE challenge bound to it. */
  async authorizationUrl(params: {
    state: string;
    codeChallenge: string;
    scope?: string;
  }): Promise<string> {
    const { authorization_endpoint } = await this.metadata();
    const url = new URL(authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.#config.clientId);
    url.searchParams.set('redirect_uri', this.#config.redirectUri);
    url.searchParams.set('scope', params.scope ?? this.scopes);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    expiresIn?: number;
  }> {
    const { token_endpoint } = await this.metadata();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.#config.redirectUri,
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
      code_verifier: codeVerifier,
    });
    const response = await fetch(this.#serverUrl(token_endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) {
      throw createError.Unauthorized('could not exchange the authorization code');
    }
    const payload = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      idToken: payload.id_token,
      expiresIn: payload.expires_in,
    };
  }

  /**
   * Asks Authentik whether this token is live, and for the groups on it.
   * `undefined` means "not valid" — revoked, expired or never issued here;
   * the caller does not get to tell those apart.
   */
  async introspect(token: string): Promise<TokenClaims | undefined> {
    const cached = this.#cache.get(token);
    if (cached && Date.now() - cached.readAt < this.#config.introspectionCacheTtlMs) {
      return cached.claims;
    }

    const { introspection_endpoint } = await this.metadata();
    const response = await fetch(this.#serverUrl(introspection_endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token,
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
      }),
    });
    if (!response.ok) {
      throw createError.BadGateway(`token introspection failed with ${response.status}`);
    }

    const payload = (await response.json()) as {
      active: boolean;
      sub?: string;
      groups?: unknown;
      name?: string;
      preferred_username?: string;
      email?: string;
      ops_ahead_role?: unknown;
      exp?: number;
    };

    const claims =
      payload.active && payload.sub
        ? {
            sub: payload.sub,
            groups: this.#toStrings(payload.groups),
            name: payload.name || payload.preferred_username || undefined,
            email: payload.email || undefined,
            roleClaim:
              typeof payload.ops_ahead_role === 'string' ? payload.ops_ahead_role : undefined,
            expiresAt: payload.exp,
          }
        : undefined;

    this.#cache.set(token, { claims, readAt: Date.now() });
    this.#sweep();
    return claims;
  }

  async revoke(token: string): Promise<void> {
    const { issuer } = await this.metadata();
    const url = new URL('application/o/revoke/', this.#trailingSlash(issuer));
    await fetch(this.#serverUrl(url.toString()), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token,
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
      }),
    }).catch(() => undefined);
    this.#cache.delete(token);
  }

  /**
   * Where the browser goes to end the provider session and come back.
   * The return URL is only attached with an id token: the provider rejects
   * it otherwise. The invalidation flow still sends the browser home.
   */
  async endSessionUrl(params: {
    idToken?: string;
    postLogoutRedirectUri: string;
  }): Promise<string | undefined> {
    const { end_session_endpoint } = await this.metadata();
    if (!end_session_endpoint) return undefined;
    const url = new URL(end_session_endpoint);
    url.searchParams.set('client_id', this.#config.clientId);
    if (params.idToken) {
      url.searchParams.set('id_token_hint', params.idToken);
      url.searchParams.set('post_logout_redirect_uri', params.postLogoutRedirectUri);
    }
    return url.toString();
  }

  /**
   * Spends the refresh token for a new access token. `undefined` means the
   * refresh itself is dead — expired or revoked — and the caller is a stranger
   * again, which is what sends the front back to login.
   */
  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken?: string; idToken?: string } | undefined> {
    const { token_endpoint } = await this.metadata();
    const response = await fetch(this.#serverUrl(token_endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
      }),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
    };
    if (!payload.access_token) return undefined;
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      idToken: payload.id_token,
    };
  }

  async #discover(): Promise<ProviderMetadata> {
    const url = new URL(
      '.well-known/openid-configuration',
      this.#trailingSlash(this.#config.issuer),
    );
    const response = await fetch(this.#serverUrl(url.toString()), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw createError.BadGateway(`OIDC discovery failed with ${response.status}`);
    }
    const metadata = (await response.json()) as ProviderMetadata;
    return {
      ...metadata,
      issuer: this.#browserUrl(metadata.issuer),
      authorization_endpoint: this.#browserUrl(metadata.authorization_endpoint),
      token_endpoint: this.#browserUrl(metadata.token_endpoint),
      introspection_endpoint: this.#browserUrl(metadata.introspection_endpoint),
      end_session_endpoint: metadata.end_session_endpoint
        ? this.#browserUrl(metadata.end_session_endpoint)
        : undefined,
      jwks_uri: this.#browserUrl(metadata.jwks_uri),
    };
  }

  /**
   * Server-side fetches use the in-cluster origin when one is set; the
   * browser still follows the public host from discovery.
   */
  #serverUrl(url: string): string {
    const origin = this.#config.internalOrigin;
    if (!origin) return url;
    return this.#rewrite(url, new URL(this.#config.issuer).host, new URL(origin));
  }

  #browserUrl(url: string): string {
    const origin = this.#config.internalOrigin;
    if (!origin) return url;
    return this.#rewrite(url, new URL(origin).host, new URL(this.#config.issuer));
  }

  #rewrite(url: string, fromHost: string, to: URL): string {
    if (!url) return url;
    const parsed = new URL(url);
    if (parsed.host !== fromHost) return url;
    parsed.protocol = to.protocol;
    parsed.host = to.host;
    return parsed.toString();
  }

  /** Bounded so a burst of distinct tokens cannot grow the map forever. */
  #sweep(): void {
    if (this.#cache.size < 1000) return;
    const cutoff = Date.now() - this.#config.introspectionCacheTtlMs;
    for (const [token, entry] of this.#cache) {
      if (entry.readAt < cutoff) this.#cache.delete(token);
    }
  }

  #toStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  #trailingSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
  }
}
