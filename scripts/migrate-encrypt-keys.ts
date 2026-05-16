/**
 * One-time migration: encrypt existing plaintext T212 API keys.
 *
 * Reads all users with T212 credentials, checks if each key is already
 * encrypted (prefixed with 'enc:'), and encrypts plaintext keys in-place.
 *
 * Safe to run multiple times — already-encrypted values are skipped.
 * Requires NEXTAUTH_SECRET in .env (used to derive the encryption key).
 *
 * Usage:
 *   npx tsx scripts/migrate-encrypt-keys.ts           # dry-run (default)
 *   npx tsx scripts/migrate-encrypt-keys.ts --apply    # actually write
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { encryptField, isEncrypted } from '../src/lib/crypto';

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');

const KEY_FIELDS = [
  't212ApiKey',
  't212ApiSecret',
  't212IsaApiKey',
  't212IsaApiSecret',
  'telegramBotToken',
  'telegramChatId',
] as const;

async function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN — no changes will be written. Pass --apply to encrypt.\n');
  } else {
    console.log('🔐 APPLYING — encrypting plaintext keys in the database.\n');
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      t212ApiKey: true,
      t212ApiSecret: true,
      t212IsaApiKey: true,
      t212IsaApiSecret: true,
      telegramBotToken: true,
      telegramChatId: true,
    },
  });

  let totalEncrypted = 0;
  let totalSkipped = 0;
  let totalEmpty = 0;

  for (const user of users) {
    const updates: Record<string, string> = {};

    for (const field of KEY_FIELDS) {
      const value = user[field] as string | null;
      if (!value) {
        totalEmpty++;
        continue;
      }
      if (isEncrypted(value)) {
        totalSkipped++;
        console.log(`  ✓ ${user.id}.${field} — already encrypted`);
        continue;
      }

      // Plaintext key found — encrypt it
      const encrypted = encryptField(value);
      updates[field] = encrypted;
      totalEncrypted++;
      console.log(`  🔐 ${user.id}.${field} — ${DRY_RUN ? 'would encrypt' : 'encrypting'} (${value.length} chars → ${encrypted.length} chars)`);
    }

    if (!DRY_RUN && Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updates,
      });
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Users scanned:    ${users.length}`);
  console.log(`  Keys encrypted:   ${totalEncrypted}`);
  console.log(`  Already encrypted: ${totalSkipped}`);
  console.log(`  Empty (no key):   ${totalEmpty}`);

  if (DRY_RUN && totalEncrypted > 0) {
    console.log(`\n⚠ Run with --apply to encrypt ${totalEncrypted} key(s).`);
  }
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
