import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * AES-256-GCM over a string. The key is 32 base64 bytes; ciphertext is
 * `iv.ciphertext.tag` so it fits in one column or one cookie value.
 *
 * Authenticated: a flipped bit fails to decrypt rather than yielding garbage.
 */
export class SecretCipher {
  #key: Buffer;

  constructor(key: string) {
    const parsed = Buffer.from(key, 'base64');
    if (parsed.length !== KEY_BYTES) {
      throw new Error(`cipher key must be ${KEY_BYTES} base64-encoded bytes`);
    }
    this.#key = parsed;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, ciphertext, cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
  }

  decrypt(stored: string): string {
    const [iv, ciphertext, tag] = stored.split('.').map(part => Buffer.from(part, 'base64url'));
    if (!iv || !ciphertext || !tag) {
      throw new Error('ciphertext is not in the expected iv.ciphertext.tag form');
    }
    const decipher = createDecipheriv(ALGORITHM, this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

/** 32 random bytes, base64url — a secret nobody has to invent. */
export function generateSecret(): string {
  return randomBytes(KEY_BYTES).toString('base64url');
}

/** Encrypts JSON and opens it again. The payload’s shape is the caller’s. */
export class SealedJson {
  #cipher: SecretCipher;

  constructor(key: string) {
    this.#cipher = new SecretCipher(key);
  }

  seal(payload: unknown): string {
    return this.#cipher.encrypt(JSON.stringify(payload));
  }

  open<T>(value: string): T | undefined {
    try {
      return JSON.parse(this.#cipher.decrypt(value)) as T;
    } catch {
      return undefined;
    }
  }
}
