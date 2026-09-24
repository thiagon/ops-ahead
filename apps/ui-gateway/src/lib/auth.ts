import createError from 'http-errors';
import { z } from 'zod';

const roles = ['operator', 'viewer'] as const;

/** What `/auth/me` says about the caller. The cookie keeps the tokens; this does not. */
export const authIdentitySchema = z
  .object({
    sub: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
    tenants: z.array(z.string()),
    role: z.enum(roles),
  })
  .meta({ id: 'AuthIdentity' });

export type AuthIdentity = z.infer<typeof authIdentitySchema>;

/** What a person may do inside the tenants they operate. */
export type Role = AuthIdentity['role'];

/**
 * Who is calling, as one of the four credentials resolved it. The route hooks
 * read this; nothing below them parses a header again. Each credential knows
 * which analysis origin it is, so a route does not translate `kind` itself.
 */
export type Auth = UserAuth | SchedulerAuth | RunAuth | NoAuth;

export class UserAuth {
  readonly kind = 'user' as const;
  readonly sub: string;
  readonly tenants: readonly string[];
  readonly role: Role;
  readonly accessToken: string;
  readonly name?: string;
  readonly email?: string;
  /** From the cookie. Logout sends it so the provider can return to the app. */
  readonly idToken?: string;

  constructor(
    sub: string,
    tenants: readonly string[],
    role: Role,
    accessToken: string,
    name?: string,
    email?: string,
    idToken?: string,
  ) {
    this.sub = sub;
    this.tenants = tenants;
    this.role = role;
    this.accessToken = accessToken;
    this.name = name;
    this.email = email;
    this.idToken = idToken;
  }

  static from(identity: AuthIdentity & { accessToken: string; idToken?: string }): UserAuth {
    return new UserAuth(
      identity.sub,
      identity.tenants,
      identity.role,
      identity.accessToken,
      identity.name,
      identity.email,
      identity.idToken,
    );
  }

  withIdToken(idToken?: string): UserAuth {
    return new UserAuth(
      this.sub,
      this.tenants,
      this.role,
      this.accessToken,
      this.name,
      this.email,
      idToken,
    );
  }

  origin() {
    return { trigger: 'manual' as const };
  }
}

export class SchedulerAuth {
  readonly kind = 'scheduler' as const;

  origin() {
    return { trigger: 'scheduled' as const };
  }
}

export class RunAuth {
  readonly kind = 'run' as const;
  readonly runKey: string;

  constructor(runKey: string) {
    this.runKey = runKey;
  }

  origin() {
    return { trigger: 'chained' as const, parentRunKey: this.runKey };
  }
}

export class NoAuth {
  readonly kind = 'none' as const;

  origin(): never {
    throw createError.Unauthorized('this endpoint needs a recognized credential');
  }
}

export function apiKeyScheme<I extends 'cookie' | 'header'>(input: {
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

export function bearerScheme(description: string) {
  return { type: 'http' as const, scheme: 'bearer' as const, description };
}

const BEARER = /^Bearer (.+)$/i;

export function readBearer(authorization: string | undefined): string | undefined {
  return BEARER.exec(authorization ?? '')?.[1];
}
