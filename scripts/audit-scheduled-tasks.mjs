/**
 * DEPENDENCIES
 * Consumed by: manual operations, scheduler readiness checks
 * Consumes: Windows schtasks output
 * Risk-sensitive: YES — read-only audit of load-bearing automation.
 * Notes: Does not create, update, disable, or delete scheduled tasks.
 */

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const QUIET = process.argv.includes('--quiet');

export const EXPECTED_TASKS = [
  { name: 'HybridTurtle Nightly', requiredPath: 'nightly-task.bat', registerScript: 'register-nightly-task.ps1' },
  { name: 'HybridTurtle Watchdog', requiredPath: 'watchdog-task.bat', registerScript: 'register-watchdog-task.bat' },
  { name: 'HybridTurtle Midday Sync', requiredPath: 'midday-sync-task.bat', registerScript: 'register-midday-sync.ps1' },
  { name: 'HybridTurtle-Scan', requiredPath: 'auto-trade-task.bat', requiredArgument: 'scan', registerScript: 'register-auto-trade.bat' },
  { name: 'HybridTurtle-Trade-UK', requiredPath: 'auto-trade-task.bat', requiredArgument: 'uk', registerScript: 'register-auto-trade.bat' },
  { name: 'HybridTurtle-Trade-US', requiredPath: 'auto-trade-task.bat', requiredArgument: 'us', registerScript: 'register-auto-trade.bat' },
  { name: 'HybridTurtle-Trade-USC', requiredPath: 'auto-trade-task.bat', requiredArgument: 'us-close', registerScript: 'register-auto-trade.bat' },
  { name: 'HybridTurtle-HourlyStatus', requiredPath: 'hourly-status-task.bat', registerScript: 'register-auto-trade.bat' },
  { name: 'HybridTurtle-MondayBriefing', requiredPath: 'monday-briefing-task.bat', registerScript: 'scripts/register-weekly-tasks.ps1' },
  { name: 'HybridTurtle-UKBriefing', requiredPath: 'uk-briefing-task.bat', registerScript: 'scripts/register-weekly-tasks.ps1' },
  { name: 'HybridTurtle-USBriefing', requiredPath: 'us-briefing-task.bat', registerScript: 'scripts/register-weekly-tasks.ps1' },
  { name: 'HybridTurtle-WeeklyDigest', requiredPath: 'weekly-digest-task.bat', registerScript: 'scripts/register-weekly-tasks.ps1' },
  { name: 'HybridTurtle-TickerAudit', requiredPath: 'ticker-audit-task.bat', registerScript: 'scripts/register-weekly-tasks.ps1' },
  { name: 'HybridTurtle-ResearchRefresh', requiredPath: 'research-refresh-task.bat', requiredArgument: '--scheduled', registerScript: 'scripts/register-weekly-tasks.ps1' },
];

export const RETIRED_TASKS = [
  {
    name: 'HybridTurtle Intraday Alert',
    reason: 'Legacy task target is absent from this repo; nightly near-stop checks and hourly status cover current monitoring paths.',
  },
];

export function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

export function parseSchtasksCsv(output) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, fields[index] ?? '']));
  });
}

function normalizeTaskName(name) {
  return name.replace(/^\\+/, '');
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

function extractQuotedPaths(command) {
  const quoted = [...String(command ?? '').matchAll(/"([A-Za-z]:\\[^"<>|?*]+)"/g)].map((match) => match[1]);
  const unquoted = [...String(command ?? '').matchAll(/\b([A-Za-z]:\\[^\s"<>|?*]+\.(?:bat|cmd|ps1|mjs|js|ts))\b/gi)].map((match) => match[1]);
  return [...new Set([...quoted, ...unquoted])];
}

export function auditScheduledTasks(tasks, options = {}) {
  const repoRoot = options.repoRoot ?? ROOT;
  const expectedTasks = options.expectedTasks ?? EXPECTED_TASKS;
  const retiredTasks = options.retiredTasks ?? RETIRED_TASKS;
  const expectedByName = new Map(expectedTasks.map((task) => [task.name.toLowerCase(), task]));
  const retiredByName = new Map(retiredTasks.map((task) => [task.name.toLowerCase(), task]));
  const seenExpected = new Set();
  const findings = [];

  for (const task of tasks) {
    const taskName = normalizeTaskName(task.TaskName ?? task['TaskName'] ?? '');
    if (!taskName.toLowerCase().startsWith('hybridturtle')) continue;

    const expected = expectedByName.get(taskName.toLowerCase());
    const retired = retiredByName.get(taskName.toLowerCase());
    const taskToRun = task['Task To Run'] ?? '';
    const startIn = task['Start In'] ?? '';
    const state = task['Scheduled Task State'] ?? task.Status ?? '';
    const lastResult = task['Last Result'] ?? '';
    const disabled = /disabled/i.test(state);

    if (expected) {
      seenExpected.add(expected.name.toLowerCase());

      const requiredPath = path.join(repoRoot, expected.requiredPath);
      if (!normalizeText(taskToRun).includes(normalizeText(requiredPath))) {
        findings.push({ severity: 'ERROR', taskName, reason: 'EXPECTED_PATH_MISMATCH', detail: `Expected action to include ${requiredPath}` });
      }

      if (expected.requiredArgument && !normalizeText(taskToRun).includes(normalizeText(expected.requiredArgument))) {
        findings.push({ severity: 'ERROR', taskName, reason: 'EXPECTED_ARGUMENT_MISSING', detail: `Expected action argument ${expected.requiredArgument}` });
      }

      if (startIn && startIn !== 'N/A' && normalizeText(startIn) !== normalizeText(repoRoot)) {
        findings.push({ severity: 'WARNING', taskName, reason: 'START_IN_MISMATCH', detail: `Start In is ${startIn}` });
      }
    }

    if (disabled) {
      findings.push({ severity: 'WARNING', taskName, reason: retired ? 'RETIRED_TASK_DISABLED' : 'TASK_DISABLED', detail: retired?.reason ?? 'Task is disabled' });
    } else if (retired) {
      findings.push({ severity: 'ERROR', taskName, reason: 'RETIRED_TASK_ENABLED', detail: retired.reason });
    }

    if (lastResult && !['0', '267009', '267011'].includes(lastResult)) {
      findings.push({ severity: 'WARNING', taskName, reason: 'NON_ZERO_LAST_RESULT', detail: `Last Result is ${lastResult}` });
    }

    const referencedPaths = extractQuotedPaths(taskToRun);
    for (const referencedPath of referencedPaths) {
      if (!existsSync(referencedPath)) {
        findings.push({ severity: disabled ? 'WARNING' : 'ERROR', taskName, reason: 'MISSING_TARGET_PATH', detail: referencedPath });
      }
    }

    if (!expected && !retired) {
      findings.push({ severity: 'WARNING', taskName, reason: 'UNTRACKED_HYBRIDTURTLE_TASK', detail: 'Task is not in the expected scheduler manifest' });
    }
  }

  for (const expected of expectedTasks) {
    if (!seenExpected.has(expected.name.toLowerCase())) {
      findings.push({ severity: 'ERROR', taskName: expected.name, reason: 'EXPECTED_TASK_MISSING', detail: 'Task was not registered' });
    }
  }

  return findings;
}

export function runSchedulerAudit(options = {}) {
  if (process.platform !== 'win32' && !options.schtasksOutput) {
    return [{ severity: 'WARNING', taskName: '*', reason: 'UNSUPPORTED_PLATFORM', detail: 'Scheduler audit requires Windows schtasks output' }];
  }

  const output = options.schtasksOutput ?? execFileSync('schtasks', ['/Query', '/FO', 'CSV', '/V'], { encoding: 'utf8' });
  return auditScheduledTasks(parseSchtasksCsv(output), options);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function auditRegisterScripts(options = {}) {
  const repoRoot = options.repoRoot ?? ROOT;
  const expectedTasks = options.expectedTasks ?? EXPECTED_TASKS;
  const readFile = options.readFile ?? ((filePath) => readFileSync(filePath, 'utf8'));
  const exists = options.existsSync ?? existsSync;
  const findings = [];

  for (const task of expectedTasks) {
    if (!task.registerScript) {
      findings.push({ severity: 'WARNING', taskName: task.name, reason: 'MANIFEST_MISSING_REGISTER_SCRIPT', detail: 'No registerScript field on manifest entry' });
      continue;
    }

    const scriptPath = path.join(repoRoot, task.registerScript);
    if (!exists(scriptPath)) {
      findings.push({ severity: 'ERROR', taskName: task.name, reason: 'REGISTER_SCRIPT_MISSING', detail: `Register script not found: ${task.registerScript}` });
      continue;
    }

    let contents = '';
    try {
      contents = readFile(scriptPath);
    } catch (err) {
      findings.push({ severity: 'ERROR', taskName: task.name, reason: 'REGISTER_SCRIPT_UNREADABLE', detail: err.message });
      continue;
    }

    const namePattern = new RegExp(`["']${escapeRegex(task.name)}["']`);
    if (!namePattern.test(contents)) {
      findings.push({ severity: 'ERROR', taskName: task.name, reason: 'REGISTER_SCRIPT_TASK_NAME_NOT_FOUND', detail: `Task name not present in ${task.registerScript}` });
      continue;
    }

    const targetBat = task.requiredPath;
    // Match the basename so registerScripts that reference the target via
    // forward-slash, backslash, or no path separator all satisfy the check.
    const targetBasename = path.basename(targetBat);
    const batPattern = new RegExp(escapeRegex(targetBasename), 'i');
    if (!batPattern.test(contents)) {
      findings.push({ severity: 'WARNING', taskName: task.name, reason: 'REGISTER_SCRIPT_TARGET_NOT_REFERENCED', detail: `Target ${targetBat} not referenced in ${task.registerScript}` });
    }
  }

  return findings;
}

export function auditDatabaseBackup(options = {}) {
  const repoRoot = options.repoRoot ?? ROOT;
  const backupDir = options.backupDir ?? path.join(repoRoot, 'prisma', 'backups');
  const maxAgeHours = options.maxAgeHours ?? 48;
  const nowMs = options.nowMs ?? Date.now();
  const exists = options.existsSync ?? existsSync;
  const readDir = options.readdirSync ?? readdirSync;
  const stat = options.statSync ?? statSync;

  if (!exists(backupDir)) {
    return [{ severity: 'WARNING', taskName: 'db-backup', reason: 'BACKUP_DIR_MISSING', detail: backupDir }];
  }

  const candidates = readDir(backupDir)
    .filter((fileName) => /^dev\.db\.backup-\d{4}-\d{2}-\d{2}-\d{4}$/.test(fileName));

  if (candidates.length === 0) {
    return [{ severity: 'ERROR', taskName: 'db-backup', reason: 'NO_NIGHTLY_BACKUP', detail: 'No dev.db.backup-* files found; nightly backup may not be running.' }];
  }

  let newestMtime = 0;
  let newestName = '';
  for (const fileName of candidates) {
    const stats = stat(path.join(backupDir, fileName));
    if (stats.mtimeMs > newestMtime) {
      newestMtime = stats.mtimeMs;
      newestName = fileName;
    }
  }

  const ageHours = (nowMs - newestMtime) / (1000 * 60 * 60);
  if (ageHours > maxAgeHours) {
    return [{ severity: 'ERROR', taskName: 'db-backup', reason: 'BACKUP_STALE', detail: `Newest backup ${newestName} is ${ageHours.toFixed(1)}h old (>${maxAgeHours}h). Pre-execution gate will HARD_BLOCK trading.` }];
  }

  return [];
}

function logFindings(findings) {
  if (findings.length === 0) {
    if (!QUIET) console.log('[scheduler-audit] OK: all expected HybridTurtle scheduled tasks are registered with valid targets.');
    return;
  }

  for (const finding of findings) {
    console.log(`[scheduler-audit] ${finding.severity}: ${finding.taskName} ${finding.reason} - ${finding.detail}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const findings = [
    ...runSchedulerAudit(),
    ...auditRegisterScripts(),
    ...auditDatabaseBackup(),
  ];
  logFindings(findings);
  process.exit(findings.some((finding) => finding.severity === 'ERROR') ? 1 : 0);
}