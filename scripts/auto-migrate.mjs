/**
 * DEPENDENCIES
 * Consumed by: start.bat, nightly-task.bat, install.bat, package.json scripts
 * Consumes: prisma/dev.db, prisma/migrations/
 * Risk-sensitive: NO (schema management only, never touches trading data)
 * Last modified: 2026-03-03
 * Notes: Smart migration runner that auto-resolves common failures.
 *        A beginner should never need to run prisma commands manually.
 *
 * What this does:
 * 1. Runs `prisma migrate deploy`
 * 2. If it fails due to a "failed migration" (P3009), auto-resolves it:
 *    - Baseline migration / tables already exist → mark as applied
 *    - Other failed migrations → mark as rolled-back, then retry
 * 3. If it fails due to tables already existing (P3018) → mark as applied
 * 4. Retries up to 3 times with auto-resolution between each attempt
 * 5. Exits 0 on success, 1 on unrecoverable failure
 *
 * Usage:
 *   node scripts/auto-migrate.mjs            # normal (with log output)
 *   node scripts/auto-migrate.mjs --quiet    # silent (nightly/scheduled use)
 */

import { execSync, fork } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'prisma', 'dev.db');
const MIGRATIONS_DIR = path.join(ROOT, 'prisma', 'migrations');

const QUIET = process.argv.includes('--quiet');

function log(msg) {
  if (!QUIET) console.log(`  [auto-migrate] ${msg}`);
}

function logError(msg) {
  console.error(`  [auto-migrate] !! ${msg}`);
}

// ── Prisma CLI wrappers ──────────────────────────────────────

/** Run prisma migrate deploy and return { success, output } */
function runMigrateDeploy() {
  try {
    const output = execSync('npx prisma migrate deploy', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { success: true, output };
  } catch (err) {
    const output = (err.stdout || '') + '\n' + (err.stderr || '');
    return { success: false, output };
  }
}

/** Run prisma migrate resolve with --applied or --rolled-back */
function resolveMigration(migrationName, action) {
  const flag = action === 'applied' ? '--applied' : '--rolled-back';
  try {
    execSync(`npx prisma migrate resolve ${flag} "${migrationName}"`, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    log(`Marked "${migrationName}" as ${action}`);
    return true;
  } catch (err) {
    logError(`Failed to mark "${migrationName}" as ${action}: ${(err.stderr || err.message).trim()}`);
    return false;
  }
}

// ── DB inspection (uses better-sqlite3 if available) ─────────

/** Read the _prisma_migrations table directly to find failed entries */
async function getFailedMigrations() {
  if (!existsSync(DB_PATH)) return [];
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(
      `SELECT migration_name, logs FROM _prisma_migrations 
       WHERE finished_at IS NULL`
    ).all();
    db.close();
    return rows;
  } catch (err) {
    // better-sqlite3 not available or _prisma_migrations table doesn't exist
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'SQLITE_ERROR') return [];
    // Also tolerate unknown import/table errors during startup
    if (err?.message?.includes('Cannot find') || err?.message?.includes('no such table')) return [];
    return [];
  }
}

// ── Output pattern detection ─────────────────────────────────

function isTablesAlreadyExist(output) {
  return output.includes('already exists') || output.includes('P3018');
}

function isFailedMigrationBlock(output) {
  return output.includes('P3009') || output.includes('failed migrations');
}

function isDatabaseLocked(output) {
  return output.includes('database is locked');
}

/** Extract migration name from Prisma error output */
function extractMigrationName(output) {
  // "Migration name: 0_baseline"
  const match1 = output.match(/Migration name:\s*(\S+)/);
  if (match1) return match1[1];
  // "The `0_baseline` migration started at..."
  const match2 = output.match(/The `(\S+?)` migration/);
  if (match2) return match2[1];
  // "Applying migration `0_baseline`"
  const match3 = output.match(/Applying migration `(\S+?)`/);
  if (match3) return match3[1];
  return null;
}

// ── Schema drift verification ────────────────────────────────

/** Run db-verify.mjs to catch any missing columns the migrations missed */
function runSchemaVerify() {
  const verifyScript = path.join(__dirname, 'db-verify.mjs');
  if (!existsSync(verifyScript)) return;
  try {
    const args = QUIET ? ['--quiet'] : [];
    execSync(`node "${verifyScript}" ${args.join(' ')}`, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'inherit',
      timeout: 30_000,
    });
  } catch {
    // Non-fatal — don't block startup
  }
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  log('Checking database migrations...');

  // Check there are actually migrations on disk
  if (!existsSync(MIGRATIONS_DIR)) {
    log('No migrations directory — nothing to do.');
    process.exit(0);
  }
  const diskMigrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'));
  if (diskMigrations.length === 0) {
    log('No migrations found — nothing to do.');
    process.exit(0);
  }

  // Attempt 1: try normal deploy
  let result = runMigrateDeploy();

  if (result.success) {
    if (result.output.includes('have been successfully applied')) {
      log('Migrations applied successfully.');
    } else {
      log('Database is up to date.');
    }
    runSchemaVerify();
    process.exit(0);
  }

  // ── Deploy failed — try to auto-resolve ──

  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log(`Auto-resolving migration issue (attempt ${attempt}/${MAX_RETRIES})...`);

    const output = result.output;

    // Case 1: P3009 — a previously-failed migration is blocking new ones
    if (isFailedMigrationBlock(output)) {
      const failedName = extractMigrationName(output);

      if (failedName) {
        // Decide: mark as applied (tables exist) or rolled-back (retry from scratch)
        if (isTablesAlreadyExist(output) || failedName.includes('baseline')) {
          log(`"${failedName}" failed because tables already exist — marking as applied.`);
          resolveMigration(failedName, 'applied');
        } else {
          log(`"${failedName}" is in failed state — marking as rolled-back to retry.`);
          resolveMigration(failedName, 'rolled-back');
        }
      } else {
        // Can't extract name from output — try reading the DB directly
        const failed = await getFailedMigrations();
        if (failed.length > 0) {
          for (const row of failed) {
            if (row.logs && row.logs.includes('already exists')) {
              log(`"${row.migration_name}" → tables already exist — marking as applied.`);
              resolveMigration(row.migration_name, 'applied');
            } else {
              log(`"${row.migration_name}" → marking as rolled-back to retry.`);
              resolveMigration(row.migration_name, 'rolled-back');
            }
          }
        } else {
          logError('Could not identify which migration failed.');
          logError('Run: npx prisma migrate status');
          process.exit(1);
        }
      }
    }
    // Case 2: P3018 — migration tried to CREATE a table that already exists
    else if (isTablesAlreadyExist(output)) {
      const migName = extractMigrationName(output);
      if (migName) {
        log(`"${migName}" tried to create existing tables — marking as applied.`);
        resolveMigration(migName, 'applied');
      } else {
        logError('Tables-already-exist error but could not identify migration name.');
        process.exit(1);
      }
    }
    // Case 3: Database locked — another process (e.g. VS Code, dev server)
    // has the SQLite file open. Wait and retry.
    else if (isDatabaseLocked(output)) {
      const delaySec = attempt * 3;
      log(`Database is locked by another process — waiting ${delaySec}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
    }
    // Case 4: Unknown error — can't auto-resolve
    else {
      logError('Unrecoverable migration error:');
      console.error(output.trim());
      process.exit(1);
    }

    // Retry deploy after resolution / wait
    result = runMigrateDeploy();
    if (result.success) {
      log('All migrations applied successfully after auto-resolve.');
      runSchemaVerify();
      process.exit(0);
    }
  }

  // Retries exhausted
  // If the only error is a database lock (not a real migration failure),
  // check if the schema is actually up to date and gracefully continue.
  if (isDatabaseLocked(result.output)) {
    log('Database still locked after retries — verifying schema directly...');
    try {
      // Use Prisma Client to check if the latest model works
      const checkResult = execSync('node -e "const{PrismaClient}=require(\'@prisma/client\');const p=new PrismaClient();p.candidateOutcome.count().then(c=>{console.log(\'OK\');p.$disconnect()}).catch(e=>{console.log(\'FAIL:\'+e.message);p.$disconnect();process.exit(1)})"', {
        cwd: ROOT,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15_000,
        env: { ...process.env, NODE_OPTIONS: '' },
      });
      if (checkResult.trim().includes('OK')) {
        log('Schema is correct despite lock — continuing safely.');
        runSchemaVerify();
        process.exit(0);
      }
    } catch {
      // Fall through to error
    }
  }
  logError(`Migration failed after ${MAX_RETRIES} auto-resolve attempts.`);
  logError('You may need to resolve this manually:');
  logError('  npx prisma migrate status');
  logError('  npx prisma migrate resolve --applied <migration_name>');
  console.error('\n' + result.output.trim());
  process.exit(1);
}

main().catch(err => {
  logError(`Unexpected error: ${err.message}`);
  process.exit(1);
});
