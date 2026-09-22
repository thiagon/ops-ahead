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
 * Who is calling. The request hook builds exactly one of these from what
 * arrived; nothing below it reads a header again.
 */
export type Auth = UserAuth | SchedulerAuth | RunAuth | NoAuth;

export class UserAuth {
  readonly kind = 'user' as const;
  readonly sub: string;
  readonly name?: string;
  readonly email?: string;
  readonly tenants: readonly string[];
  readonly role: Role;
  readonly accessToken: string;
  /** From the cookie. Logout sends it so the provider can return to the app. */
  readonly idToken?: string;

  constructor(input: AuthIdentity & { accessToken: string; idToken?: string }) {
    this.sub = input.sub;
    this.name = input.name;
    this.email = input.email;
    this.tenants = input.tenants;
    this.role = input.role;
    this.accessToken = input.accessToken;
    this.idToken = input.idToken;
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
