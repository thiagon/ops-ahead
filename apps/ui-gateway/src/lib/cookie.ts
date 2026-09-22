/** One cookie from a `Cookie` header. `undefined` when that name is absent. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** `Set-Cookie` attributes. HttpOnly is the caller’s to add; this is the rest. */
export function cookieAttributes(opts: {
  secure: boolean;
  maxAgeSeconds?: number;
  domain?: string;
}): string {
  const parts = ['Path=/', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  // Shared parent of the UI and gateway hosts. Without it the cookie is
  // host-only on the gateway and the front never sees the session.
  const domain = opts.domain?.replace(/^\./, '').trim();
  if (domain) parts.push(`Domain=${domain}`);
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  return parts.join('; ');
}
