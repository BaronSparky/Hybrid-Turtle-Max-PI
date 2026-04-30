#!/usr/bin/env node
/**
 * DEPENDENCIES
 * Consumed by: manual maintenance, future auto-migrate integration
 * Consumes: prisma/dev.db or DATABASE_URL SQLite path
 * Risk-sensitive: YES — schema reconciliation. Dry-run by default.
 * Notes: Reconciles known additive drift only. Never drops, rebuilds, or renames tables.
 */

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PRISMA_DIR = path.join(ROOT, 'prisma');
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const QUIET = process.argv.includes('--quiet');

function log(message) {
  if (!QUIET) console.log(`[schema-reconcile] ${message}`);
}

function resolveSqliteDbPath(databaseUrl) {
  if (!databaseUrl?.startsWith('file:')) {
    return path.join(PRISMA_DIR, 'dev.db');
  }

  const filePath = databaseUrl.slice('file:'.length);
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(PRISMA_DIR, filePath);
}

const DB_PATH = resolveSqliteDbPath(process.env.DATABASE_URL);

function hasTable(db, tableName) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(tableName);
  return !!row;
}

function hasIndex(db, indexName) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?"
  ).get(indexName);
  return !!row;
}

function tableColumns(db, tableName) {
  if (!hasTable(db, tableName)) return new Set();
  return new Set(db.pragma(`table_info("${tableName}")`).map((row) => row.name));
}

function addStatement(statements, label, sql) {
  statements.push({ label, sql });
}

function planReconciliation(db) {
  const statements = [];

  const scanResultColumns = tableColumns(db, 'ScanResult');
  if (scanResultColumns.size > 0 && !scanResultColumns.has('grade')) {
    addStatement(statements, 'Add ScanResult.grade', 'ALTER TABLE "ScanResult" ADD COLUMN "grade" TEXT');
  }
  if (scanResultColumns.size > 0 && !scanResultColumns.has('gradeReason')) {
    addStatement(statements, 'Add ScanResult.gradeReason', 'ALTER TABLE "ScanResult" ADD COLUMN "gradeReason" TEXT');
  }

  if (!hasTable(db, 'OverrideLog')) {
    addStatement(statements, 'Create OverrideLog table', `CREATE TABLE "OverrideLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action" TEXT NOT NULL,
  "ticker" TEXT,
  "blockedRule" TEXT NOT NULL,
  "blockType" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "riskProfile" TEXT NOT NULL,
  "operatingMode" TEXT NOT NULL,
  "systemRecommendation" TEXT NOT NULL,
  "actionCompleted" BOOLEAN NOT NULL DEFAULT false,
  "tradeOutcomeR" REAL
)`);
  }
  if (!hasIndex(db, 'OverrideLog_userId_idx')) {
    addStatement(statements, 'Create OverrideLog_userId_idx', 'CREATE INDEX "OverrideLog_userId_idx" ON "OverrideLog"("userId")');
  }
  if (!hasIndex(db, 'OverrideLog_timestamp_idx')) {
    addStatement(statements, 'Create OverrideLog_timestamp_idx', 'CREATE INDEX "OverrideLog_timestamp_idx" ON "OverrideLog"("timestamp")');
  }

  if (!hasTable(db, 'PriceSnapshot')) {
    addStatement(statements, 'Create PriceSnapshot table', `CREATE TABLE "PriceSnapshot" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ticker" TEXT NOT NULL,
  "t212Price" REAL NOT NULL,
  "yahooPrice" REAL,
  "diffPercent" REAL,
  "source" TEXT NOT NULL DEFAULT 'T212_FETCH',
  "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
  }
  if (!hasIndex(db, 'PriceSnapshot_ticker_idx')) {
    addStatement(statements, 'Create PriceSnapshot_ticker_idx', 'CREATE INDEX "PriceSnapshot_ticker_idx" ON "PriceSnapshot"("ticker")');
  }
  if (!hasIndex(db, 'PriceSnapshot_capturedAt_idx')) {
    addStatement(statements, 'Create PriceSnapshot_capturedAt_idx', 'CREATE INDEX "PriceSnapshot_capturedAt_idx" ON "PriceSnapshot"("capturedAt")');
  }
  if (!hasIndex(db, 'PriceSnapshot_ticker_capturedAt_idx')) {
    addStatement(statements, 'Create PriceSnapshot_ticker_capturedAt_idx', 'CREATE INDEX "PriceSnapshot_ticker_capturedAt_idx" ON "PriceSnapshot"("ticker", "capturedAt")');
  }

  return statements;
}

async function main() {
  if (!existsSync(DB_PATH)) {
    log(`Database not found at ${DB_PATH}. Nothing to reconcile.`);
    process.exit(0);
  }

  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);

  try {
    const statements = planReconciliation(db);

    if (statements.length === 0) {
      log('No known schema drift found.');
      return;
    }

    log(`${APPLY ? 'Applying' : 'Dry run'}: ${statements.length} reconciliation action(s).`);
    for (const statement of statements) {
      log(`- ${statement.label}`);
      if (!QUIET) console.log(statement.sql);
      if (APPLY) db.exec(statement.sql);
    }

    if (CHECK && !APPLY) {
      log('Known schema drift detected. Re-run with --apply after backing up the database.');
      process.exitCode = 2;
      return;
    }

    if (!APPLY) {
      log('Dry run only. Re-run with --apply after backing up the database.');
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`[schema-reconcile] Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
