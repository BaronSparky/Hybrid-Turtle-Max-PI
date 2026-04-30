import { closeSync, existsSync, mkdtempSync, openSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { planBackupCleanup, runBackupCleanup } from './cleanup-db-backups.mjs';

const tempDirs: string[] = [];

function makeTempBackupDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hybridturtle-backups-'));
  tempDirs.push(dir);
  return dir;
}

function touchFile(dir: string, fileName: string, mtime: Date) {
  const filePath = path.join(dir, fileName);
  closeSync(openSync(filePath, 'w'));
  utimesSync(filePath, mtime, mtime);
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cleanup-db-backups.mjs', () => {
  it('plans cleanup only for managed timestamped backups beyond retention', () => {
    const backupDir = makeTempBackupDir();
    const now = new Date('2026-04-30T12:00:00Z');
    touchFile(backupDir, 'dev-before-reconcile-20260430-085827.db', new Date('2026-04-30T08:58:27Z'));
    touchFile(backupDir, 'dev.db.backup-2026-04-28-2011', new Date('2026-04-28T20:11:00Z'));
    touchFile(backupDir, 'dev.db.backup-2026-03-01-1200', new Date('2026-03-01T12:00:00Z'));
    touchFile(backupDir, 'dev.db.stable-baseline-2026-04-28', new Date('2026-04-28T12:00:00Z'));

    const planned = planBackupCleanup({ backupDir, keep: 2, maxAgeDays: 30, nowMs: now.getTime() });

    expect(planned.map((entry) => entry.fileName)).toEqual(['dev.db.backup-2026-03-01-1200']);
  });

  it('dry-runs without deleting planned backups', () => {
    const backupDir = makeTempBackupDir();
    const oldBackup = touchFile(backupDir, 'dev.db.backup-2026-03-01-1200', new Date('2026-03-01T12:00:00Z'));

    const planned = runBackupCleanup({ backupDir, keep: 0, maxAgeDays: 30, nowMs: new Date('2026-04-30T12:00:00Z').getTime(), apply: false });

    expect(planned).toHaveLength(1);
    expect(existsSync(oldBackup)).toBe(true);
  });

  it('deletes only planned backups when apply is explicit', () => {
    const backupDir = makeTempBackupDir();
    const oldBackup = touchFile(backupDir, 'dev.db.backup-2026-03-01-1200', new Date('2026-03-01T12:00:00Z'));
    const stableBackup = touchFile(backupDir, 'dev.db.stable-baseline-2026-04-28', new Date('2026-03-01T12:00:00Z'));

    const planned = runBackupCleanup({ backupDir, keep: 0, maxAgeDays: 30, nowMs: new Date('2026-04-30T12:00:00Z').getTime(), apply: true });

    expect(planned).toHaveLength(1);
    expect(existsSync(oldBackup)).toBe(false);
    expect(existsSync(stableBackup)).toBe(true);
  });
});