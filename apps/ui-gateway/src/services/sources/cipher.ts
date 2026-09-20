import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Encrypts a source's webhook secret for storage. The signature check needs
 * the secret itself to recompute the digest, so it cannot be hashed the way
 * an analysis update key is — it is encrypted instead, and the key that
 * decrypts it lives in the Vault, never in the database. A dump of the
 * database is inert on its own.
 *
 * GCM authenticates as well as encrypts: a tampered ciphertext fails to
 * decrypt rather than yielding a wrong secret.
 */
export class SecretCipher {
  #key: Buffer;

  constructor(key: string) {
    const parsed = Buffer.from(key, 'base64');
    if (parsed.length !== KEY_BYTES) {
      throw new Error(`SOURCE_SECRET_KEY must be ${KEY_BYTES} base64-encoded bytes`);
    }
    this.#key = parsed;
  }

  /** `iv.ciphertext.tag`, each base64url — one column, no schema to migrate. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, ciphertext, cipher.getAuthTag()].map(part => part.toString('base64url')).join('.');
  }

  decrypt(stored: string): string {
    const [iv, ciphertext, tag] = stored.split('.').map(part => Buffer.from(part, 'base64url'));
    if (!iv || !ciphertext || !tag) {
      throw new Error('stored secret is not in the expected iv.ciphertext.tag form');
    }
    const decipher = createDecipheriv(ALGORITHM, this.#key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

/** What a rotation mints when the caller does not bring its own. */
export function generateSecret(): string {
  return randomBytes(KEY_BYTES).toString('base64url');
}
