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
 * read this; nothing below them parses a header again.
 */
export type Auth =
  | ({
      kind: 'user';
      accessToken: string;
      /** From the cookie. Logout sends it so the provider can return to the app. */
      idToken?: string;
    } & AuthIdentity)
  | { kind: 'scheduler' }
  | { kind: 'run'; runKey: string }
  | { kind: 'none' };

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
