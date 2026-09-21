/** `Set-Cookie` attributes. HttpOnly is the caller’s to add; this is the rest. */
export function cookieAttributes(secure: boolean, maxAgeSeconds?: number): string {
  const parts = ['Path=/', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}
