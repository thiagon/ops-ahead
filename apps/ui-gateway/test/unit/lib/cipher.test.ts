import { describe, expect, it } from 'vitest';
import { generateSecret, SecretCipher } from '../../../src/lib/cipher.ts';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

describe('SecretCipher', () => {
  it('round-trips a secret', () => {
    const cipher = new SecretCipher(KEY);

    expect(cipher.decrypt(cipher.encrypt('sekret'))).toBe('sekret');
  });

  it('never produces the same ciphertext twice for one secret', () => {
    const cipher = new SecretCipher(KEY);

    // A fresh iv per write, so equal secrets are not equal rows.
    expect(cipher.encrypt('sekret')).not.toBe(cipher.encrypt('sekret'));
  });

  it('refuses a ciphertext produced under another key', () => {
    const stored = new SecretCipher(OTHER_KEY).encrypt('sekret');

    expect(() => new SecretCipher(KEY).decrypt(stored)).toThrow();
  });

  it('refuses a tampered ciphertext rather than returning the wrong secret', () => {
    const cipher = new SecretCipher(KEY);
    const [iv, ciphertext, tag] = cipher.encrypt('sekret').split('.');
    const flipped = Buffer.from(ciphertext ?? '', 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    expect(() => cipher.decrypt(`${iv}.${flipped.toString('base64url')}.${tag}`)).toThrow();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new SecretCipher(Buffer.alloc(16, 7).toString('base64'))).toThrow(
      /32 base64-encoded bytes/,
    );
  });
});

describe('generateSecret', () => {
  it('mints a different secret every time', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });
});
