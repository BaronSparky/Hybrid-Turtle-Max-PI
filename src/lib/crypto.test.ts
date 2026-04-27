import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { encryptField, decryptField, isEncrypted } from './crypto';

describe('crypto field encryption', () => {
  const originalEnv = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'test-secret-for-unit-tests-32chars!';
  });

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = originalEnv;
  });

  it('encrypts and decrypts a string correctly', () => {
    const plaintext = 'my-api-key-12345';
    const encrypted = encryptField(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.startsWith('enc:')).toBe(true);
    expect(decryptField(encrypted)).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const plaintext = 'same-key';
    const a = encryptField(plaintext);
    const b = encryptField(plaintext);
    expect(a).not.toBe(b);
    // Both decrypt to the same value
    expect(decryptField(a)).toBe(plaintext);
    expect(decryptField(b)).toBe(plaintext);
  });

  it('returns empty string as-is', () => {
    expect(encryptField('')).toBe('');
    expect(decryptField('')).toBe('');
  });

  it('returns non-encrypted strings as-is (backward compat)', () => {
    const plainKey = 'old-style-plain-key';
    expect(decryptField(plainKey)).toBe(plainKey);
  });

  it('isEncrypted detects encrypted values', () => {
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted('plain-key')).toBe(false);
    expect(isEncrypted(encryptField('test'))).toBe(true);
  });

  it('fails to decrypt with wrong secret', () => {
    const encrypted = encryptField('secret-key');
    process.env.NEXTAUTH_SECRET = 'different-secret-for-wrong-key!!';
    expect(() => decryptField(encrypted)).toThrow();
  });

  it('handles unicode and special characters', () => {
    const special = '🔑 key with "quotes" & <brackets>';
    const encrypted = encryptField(special);
    expect(decryptField(encrypted)).toBe(special);
  });
});
