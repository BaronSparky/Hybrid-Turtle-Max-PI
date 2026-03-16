/**
 * Database Schema Verifier
 * ────────────────────────────────────────────────────────────
 * Consumed by: auto-migrate.mjs (called after migrations)
 * Consumes: prisma/schema.prisma, prisma/dev.db
 * Risk-sensitive: NO (only adds missing columns, never drops data)
 * Last modified: 2026-03-04
 *
 * What this does:
 * 1. Parses prisma/schema.prisma to find every model and its columns
 * 2. Opens the SQLite database and reads the actual table columns
 * 3. If any column exists in the schema but NOT in the database,
 *    it runs ALTER TABLE … ADD COLUMN to add it automatically
 * 4. Reports what it fixed (or confirms everything is fine)
 *
 * This prevents the "column does not exist" error that happens when
 * Prisma thinks migrations are applied but the database is out of sync.
 *
 * Usage:
 *   node scripts/db-verify.mjs            # normal (with log output)
 *   node scripts/db-verify.mjs --quiet    # silent mode
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'prisma', 'schema.prisma');
const DB_PATH = path.join(ROOT, 'prisma', 'dev.db');

const QUIET = process.argv.includes('--quiet');

function log(msg) {
  if (!QUIET) console.log(`  [db-verify] ${msg}`);
}
function logError(msg) {
  console.error(`  [db-verify] !! ${msg}`);
}

// ── Prisma type → SQLite type mapping ────────────────────────

function prismaTypeToSqlite(prismaType) {
  const base = prismaType.replace('?', '').replace('[]', '').trim();
  switch (base) {
    case 'String':   return 'TEXT';
    case 'Int':      return 'INTEGER';
    case 'Float':    return 'REAL';
    case 'Boolean':  return 'BOOLEAN';   // SQLite stores as INTEGER, but column type text is fine
    case 'DateTime': return 'DATETIME';
    case 'BigInt':   return 'BIGINT';
    case 'Decimal':  return 'DECIMAL';
    case 'Bytes':    return 'BLOB';
    case 'Json':     return 'TEXT';      // SQLite doesn't have JSON type
    default:         return null;        // Relation or unknown — skip
  }
}

/** Extract default value for ALTER TABLE from Prisma @default(...) */
function extractDefault(line, sqliteType) {
  const match = line.match(/@default\(([^)]+)\)/);
  if (!match) return null;

  const val = match[1].trim();

  // Skip function defaults like now(), cuid(), autoincrement() etc.
  if (val.includes('(')) return null;

  // Boolean
  if (val === 'true') return 'DEFAULT 1';
  if (val === 'false') return 'DEFAULT 0';

  // String (quoted)
  if (val.startsWith('"') && val.endsWith('"')) {
    return `DEFAULT ${val.replace(/"/g, "'")}`;
  }

  // Number
  if (!isNaN(Number(val))) {
    return `DEFAULT ${val}`;
  }

  return null;
}

// ── Parse the Prisma schema ──────────────────────────────────

function parseSchema() {
  const schemaText = readFileSync(SCHEMA_PATH, 'utf-8');
  const models = {};
  let currentModel = null;

  for (const rawLine of schemaText.split('\n')) {
    const line = rawLine.trim();

    // Start of model block
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      models[currentModel] = [];
      continue;
    }

    // End of model block
    if (currentModel && line === '}') {
      currentModel = null;
      continue;
    }

    // Skip non-model lines, comments, empty lines, relation-only lines
    if (!currentModel) continue;
    if (line.startsWith('//') || line.startsWith('@@') || line === '') continue;

    // Parse field: "fieldName  Type  @directives..."
    const fieldMatch = line.match(/^(\w+)\s+(\S+)/);
    if (!fieldMatch) continue;

    const fieldName = fieldMatch[1];
    const fieldType = fieldMatch[2];
    const sqliteType = prismaTypeToSqlite(fieldType);

    // Skip relations (type is another model name or array type)
    if (!sqliteType) continue;

    const isOptional = fieldType.endsWith('?');
    const defaultClause = extractDefault(line, sqliteType);

    models[currentModel].push({
      name: fieldName,
      sqliteType,
      isOptional,
      defaultClause,
    });
  }

  return models;
}

// ── Get actual SQLite table columns ──────────────────────────

function getTableColumns(db, tableName) {
  try {
    const rows = db.pragma(`table_info("${tableName}")`);
    return new Set(rows.map(r => r.name));
  } catch {
    return null; // Table doesn't exist
  }
}

async function getTableColumnsViaPrisma(prisma, tableName) {
  try {
    const rows = await prisma.$queryRawUnsafe(`PRAGMA table_info("${tableName}")`);
    return new Set(rows.map((row) => row.name));
  } catch {
    return null;
  }
}

async function createDbAdapter() {
  try {
    const mod = await import('better-sqlite3');
    const Database = mod.default;
    const db = new Database(DB_PATH);
    return {
      kind: 'better-sqlite3',
      async getTableColumns(tableName) {
        return getTableColumns(db, tableName);
      },
      async exec(sql) {
        db.exec(sql);
      },
      async close() {
        db.close();
      },
    };
  } catch {
    const mod = await import('@prisma/client');
    const prisma = new mod.PrismaClient();
    return {
      kind: 'prisma',
      async getTableColumns(tableName) {
        return getTableColumnsViaPrisma(prisma, tableName);
      },
      async exec(sql) {
        await prisma.$executeRawUnsafe(sql);
      },
      async close() {
        await prisma.$disconnect();
      },
    };
  }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  if (!existsSync(SCHEMA_PATH)) {
    logError('prisma/schema.prisma not found — skipping verification.');
    process.exit(0);
  }
  if (!existsSync(DB_PATH)) {
    log('No database yet — skipping verification (migrations will create it).');
    process.exit(0);
  }

  const models = parseSchema();
  const db = await createDbAdapter();
  log(`Using ${db.kind} adapter for schema verification.`);

  let fixedCount = 0;
  let checkedCount = 0;

  for (const [modelName, fields] of Object.entries(models)) {
    const existingCols = await db.getTableColumns(modelName);
    if (!existingCols) continue; // Table doesn't exist yet — migrations will handle it

    for (const field of fields) {
      checkedCount++;

      if (!existingCols.has(field.name)) {
        // Column is in the schema but missing from the database — add it
        let sql = `ALTER TABLE "${modelName}" ADD COLUMN "${field.name}" ${field.sqliteType}`;

        if (field.defaultClause) {
          sql += ` ${field.defaultClause}`;
        } else if (!field.isOptional) {
          // Non-optional with no explicit default — use type-appropriate default
          // (SQLite doesn't allow adding NOT NULL columns without a default)
          switch (field.sqliteType) {
            case 'TEXT':     sql += " DEFAULT ''";  break;
            case 'INTEGER':  sql += ' DEFAULT 0';   break;
            case 'REAL':     sql += ' DEFAULT 0';   break;
            case 'BOOLEAN':  sql += ' DEFAULT 0';   break;
            case 'DATETIME': sql += " DEFAULT ''";  break;
            default:         sql += " DEFAULT ''";   break;
          }
        }

        try {
          await db.exec(sql);
          log(`FIXED: Added missing column "${field.name}" to "${modelName}"`);
          fixedCount++;
        } catch (err) {
          logError(`Failed to add "${field.name}" to "${modelName}": ${err.message}`);
        }
      }
    }
  }

  await db.close();

  if (fixedCount > 0) {
    log(`Schema verification complete: fixed ${fixedCount} missing column(s).`);
  } else {
    log(`Schema verification complete: all ${checkedCount} columns present.`);
  }

  process.exit(0);
}

main().catch(err => {
  logError(`Unexpected error: ${err.message}`);
  // Exit 0 intentionally: this script runs during app startup and must not
  // prevent the application from starting even if verification fails.
  // Errors are logged above for manual review.
  process.exit(0);
});
