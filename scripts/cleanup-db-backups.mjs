/**
 * DEPENDENCIES
 * Consumed by: manual maintenance
 * Consumes: prisma/backups timestamped SQLite backups
 * Risk-sensitive: YES — deletes backup files only with --apply.
 * Notes: Dry-run by default. Preserves named stable/baseline backups.
 */

import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BACKUP_DIR = path.join(ROOT, 'prisma', 'backups');
const APPLY = process.argv.includes('--apply');
const QUIET = process.argv.includes('--quiet');

function readNumberArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const KEEP = readNumberArg('keep', 10);
const MAX_AGE_DAYS = readNumberArg('max-age-days', 30);

function log(message) {
  if (!QUIET) console.log(`[backup-cleanup] ${message}`);
}

function isManagedBackupName(fileName) {
  return /^dev-before-reconcile-\d{8}-\d{6}\.db$/.test(fileName)
    || /^dev\.db\.backup-\d{4}-\d{2}-\d{2}-\d{4}$/.test(fileName);
}

export function planBackupCleanup(options = {}) {
  const backupDir = options.backupDir ?? DEFAULT_BACKUP_DIR;
  const keep = options.keep ?? KEEP;
  const maxAgeDays = options.maxAgeDays ?? MAX_AGE_DAYS;
  const nowMs = options.nowMs ?? Date.now();

  if (!existsSync(backupDir)) return [];

  const managed = readdirSync(backupDir)
    .filter(isManagedBackupName)
    .map((fileName) => {
      const filePath = path.join(backupDir, fileName);
      const stats = statSync(filePath);
      return { fileName, filePath, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const keepSet = new Set(managed.slice(0, keep).map((entry) => entry.filePath));
  const cutoffMs = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;

  return managed.filter((entry) => !keepSet.has(entry.filePath) || entry.mtimeMs < cutoffMs);
}

export function runBackupCleanup(options = {}) {
  const apply = options.apply ?? APPLY;
  const planned = planBackupCleanup(options);

  if (planned.length === 0) {
    log('No managed backups eligible for cleanup.');
    return planned;
  }

  log(`${apply ? 'Deleting' : 'Dry run'}: ${planned.length} managed backup file(s).`);
  for (const entry of planned) {
    log(`- ${entry.fileName}`);
    if (apply) unlinkSync(entry.filePath);
  }

  if (!apply) {
    log('Dry run only. Re-run with --apply after confirming the files are safe to remove.');
  }

  return planned;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runBackupCleanup();
}