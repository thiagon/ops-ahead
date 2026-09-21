import { describe, expect, it } from 'vitest';
import { cookieAttributes } from '../../../src/lib/cookie.ts';

describe('cookieAttributes', () => {
  it('is host-only when no domain is given', () => {
    expect(cookieAttributes({ secure: false })).toBe('Path=/; SameSite=Lax');
  });

  it('pins the parent domain so the UI host receives the session', () => {
    expect(cookieAttributes({ secure: false, domain: 'ops-ahead.localtest.me' })).toBe(
      'Path=/; SameSite=Lax; Domain=ops-ahead.localtest.me',
    );
  });

  it('strips a leading dot — RFC 6265 treats Domain as that host and its subdomains', () => {
    expect(cookieAttributes({ secure: true, domain: '.ops-ahead.localtest.me' })).toContain(
      'Domain=ops-ahead.localtest.me',
    );
    expect(cookieAttributes({ secure: true, domain: '.ops-ahead.localtest.me' })).toContain(
      'Secure',
    );
  });

  it('clears with Max-Age=0 on the same domain the cookie was set with', () => {
    expect(
      cookieAttributes({
        secure: false,
        domain: 'ops-ahead.localtest.me',
        maxAgeSeconds: 0,
      }),
    ).toBe('Path=/; SameSite=Lax; Domain=ops-ahead.localtest.me; Max-Age=0');
  });
});
