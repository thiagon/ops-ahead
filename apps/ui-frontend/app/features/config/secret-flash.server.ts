import { createCookie } from 'react-router';

/**
 * Carries a newly minted signing key across the create → detail redirect.
 * Cleared on the first read so the value is shown once.
 */
export const secretFlashCookie = createCookie('config-secret-flash', {
  httpOnly: true,
  maxAge: 120,
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
});

export type SecretFlash = {
  source: string;
  secret: string;
};

export async function setSecretFlash(source: string, secret: string): Promise<string> {
  return await secretFlashCookie.serialize({ source, secret } satisfies SecretFlash);
}

export async function takeSecretFlash(
  request: Request,
  source: string,
): Promise<{ secret: string | null; clearHeader: string | null }> {
  const flash = ((await secretFlashCookie.parse(request.headers.get('Cookie'))) ??
    null) as SecretFlash | null;

  if (!flash || flash.source !== source || !flash.secret) {
    return { secret: null, clearHeader: null };
  }

  return {
    secret: flash.secret,
    clearHeader: await secretFlashCookie.serialize('', { maxAge: 0 }),
  };
}
