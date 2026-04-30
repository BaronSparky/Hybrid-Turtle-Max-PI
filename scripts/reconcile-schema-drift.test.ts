import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

interface SqliteNamedRow {
  name: string;
}

interface SqliteDb {
  exec(sql: string): void;
  close(): void;
  pragma(sql: string): SqliteNamedRow[];
  prepare(sql: string): {
    get(...values: unknown[]): SqliteNamedRow | undefined;
  };
}

type DatabaseConstructor = new (filename: string) => SqliteDb;

const Database = require('better-sqlite3') as DatabaseConstructor;

const scriptPath = path.resolve(process.cwd(), 'scripts', 'reconcile-schema-drift.mjs');
const tempDirs: string[] = [];

function makeTempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hybridturtle-schema-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'dev.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE "ScanResult" ("id" TEXT NOT NULL PRIMARY KEY)');
  db.close();
  return dbPath;
}

function runReconcile(dbPath: string, args: string[] = []) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
}

function openDb(dbPath: string) {
  return new Database(dbPath);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('reconcile-schema-drift.mjs', () => {
  it('reports known drift during dry run without applying changes', () => {
    const dbPath = makeTempDb();

    const output = runReconcile(dbPath);

    expect(output).toContain('Dry run');
    expect(output).toContain('Add ScanResult.grade');
    expect(output).toContain('Create OverrideLog table');

    const db = openDb(dbPath);
    try {
      const scanColumns = db.pragma('table_info("ScanResult")').map((row) => row.name);
      const overrideLog = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'OverrideLog');
      expect(scanColumns).toEqual(['id']);
      expect(overrideLog).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('exits non-zero in check mode when known drift exists', () => {
    const dbPath = makeTempDb();

    expect(() => runReconcile(dbPath, ['--check', '--quiet'])).toThrow(expect.objectContaining({ status: 2 }));
  });

  it('applies only known additive drift when explicitly requested', () => {
    const dbPath = makeTempDb();

    const output = runReconcile(dbPath, ['--apply']);

    expect(output).toContain('Applying');

    const db = openDb(dbPath);
    try {
      const scanColumns = db.pragma('table_info("ScanResult")').map((row) => row.name);
      const overrideLog = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'OverrideLog');
      const priceSnapshot = db.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'PriceSnapshot');
      expect(scanColumns).toContain('grade');
      expect(scanColumns).toContain('gradeReason');
      expect(overrideLog).toEqual({ name: 'OverrideLog' });
      expect(priceSnapshot).toEqual({ name: 'PriceSnapshot' });
    } finally {
      db.close();
    }
  });
});
