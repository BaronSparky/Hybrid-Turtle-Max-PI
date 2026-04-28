/**
 * Re-encrypt API keys when ENCRYPTION_SECRET (or NEXTAUTH_SECRET) changes.
 *
 * Decrypts all encrypted fields using the OLD secret, then re-encrypts
 * them with the CURRENT secret (from .env / ENCRYPTION_SECRET).
 *
 * Usage:
 *   npx tsx scripts/reencrypt-keys.ts --old-secret="previous-secret-value"
 *   npx tsx scripts/reencrypt-keys.ts --old-secret="previous-secret-value" --apply
 *
 * Without --apply, runs in dry-run mode (reads and validates but does not write).
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'hybridturtle-key-encryption';
const ENC_PREFIX = 'enc:';

const KEY_FIELDS = [
  't212ApiKey',
  't212ApiSecret',
  't212IsaApiKey',
  't212IsaApiSecret',
  'telegramBotToken',
] as const;

function deriveKey(secret: string): Buffer {
  return pbkdf2Sync(secret, SALT, 100_000, 32, 'sha256');
}

function decrypt(value: string, key: Buffer): string {
  if (!value || !value.startsWith(ENC_PREFIX)) return value;
  const parts = value.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted field format');
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]).toString('utf8');
}

function encrypt(plaintext: string, key: Buffer): string {
  if (!plaintext) return plaintext;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function getOldSecret(): string {
  const flag = process.argv.find(a => a.startsWith('--old-secret='));
  if (!flag) {
    console.error('ERROR: --old-secret="your-previous-secret" is required.');
    console.error('Usage: npx tsx scripts/reencrypt-keys.ts --old-secret="old" [--apply]');
    process.exit(1);
  }
  return flag.split('=').slice(1).join('='); // handle '=' in secret
}

async function main() {
  const oldSecret = getOldSecret();
  const newSecret = process.env.ENCRYPTION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!newSecret) {
    console.error('ERROR: ENCRYPTION_SECRET (or NEXTAUTH_SECRET) must be set in .env (this is the NEW secret).');
    process.exit(1);
  }
  if (oldSecret === newSecret) {
    console.log('Old and new secrets are identical — nothing to do.');
    return;
  }

  const oldKey = deriveKey(oldSecret);
  const newKey = deriveKey(newSecret);

  if (DRY_RUN) {
    console.log('🔍 DRY RUN — no changes will be written. Pass --apply to re-encrypt.\n');
  } else {
    console.log('🔐 APPLYING — re-encrypting all keys with the new secret.\n');
  }

  const users = await prisma.user.findMany({
    select: { id: true, t212ApiKey: true, t212ApiSecret: true, t212IsaApiKey: true, t212IsaApiSecret: true, telegramBotToken: true },
  });

  let totalReEncrypted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const user of users) {
    const updates: Record<string, string> = {};

    for (const field of KEY_FIELDS) {
      const value = user[field] as string | null;
      if (!value) continue;
      if (!value.startsWith(ENC_PREFIX)) {
        console.log(`  ⏭ ${user.id}.${field} — plaintext (not encrypted), skipping`);
        totalSkipped++;
        continue;
      }

      try {
        const plaintext = decrypt(value, oldKey);
        const reEncrypted = encrypt(plaintext, newKey);
        updates[field] = reEncrypted;
        totalReEncrypted++;
        console.log(`  🔐 ${user.id}.${field} — ${DRY_RUN ? 'would re-encrypt' : 're-encrypting'}`);
      } catch (err) {
        console.error(`  ❌ ${user.id}.${field} — decryption failed: ${(err as Error).message}`);
        totalErrors++;
      }
    }

    if (!DRY_RUN && Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: updates });
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Users scanned:    ${users.length}`);
  console.log(`  Keys re-encrypted: ${totalReEncrypted}`);
  console.log(`  Skipped (plain):  ${totalSkipped}`);
  console.log(`  Errors:           ${totalErrors}`);

  if (totalErrors > 0) {
    console.error('\n⚠ Some keys failed to decrypt with the old secret. Check the errors above.');
    process.exit(1);
  }

  if (DRY_RUN && totalReEncrypted > 0) {
    console.log(`\n⚠ Run with --apply to re-encrypt ${totalReEncrypted} key(s).`);
  }
}

main()
  .catch((err) => { console.error('Re-encryption failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
