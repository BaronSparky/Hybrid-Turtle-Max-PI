/**
 * DEPENDENCIES
 * Consumed by: /api/trading212/connect/route.ts, secrets.ts, auto-trade.ts, /api/positions/execute/route.ts
 * Consumes: Node crypto, NEXTAUTH_SECRET env var
 * Risk-sensitive: YES — protects broker API keys at rest
 * Notes: AES-256-GCM encryption for sensitive fields stored in SQLite.
 *        Key is derived from NEXTAUTH_SECRET using PBKDF2.
 *        Encrypted values are prefixed with 'enc:' for detection.
 */

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT = 'hybridturtle-key-encryption'; // Static salt — key uniqueness comes from NEXTAUTH_SECRET
const ENC_PREFIX = 'enc:';

function getDerivedKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for credential encryption');
  }
  return pbkdf2Sync(secret, SALT, 100_000, 32, 'sha256');
}

/**
 * Encrypt a plaintext string. Returns a prefixed base64 string: `enc:<iv>:<authTag>:<ciphertext>`
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypt a field. Accepts both encrypted (`enc:...`) and plaintext strings.
 * Plaintext strings are returned as-is for backward compatibility during migration.
 */
export function decryptField(value: string): string {
  if (!value) return value;
  if (!value.startsWith(ENC_PREFIX)) {
    // Not encrypted — return as-is (backward compatibility)
    return value;
  }

  const key = getDerivedKey();
  const parts = value.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted field format');
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Check if a value is already encrypted.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith(ENC_PREFIX);
}
