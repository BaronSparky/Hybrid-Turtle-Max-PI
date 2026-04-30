import { describe, expect, it, vi } from 'vitest';
import { existsSync as realExistsSync } from 'fs';
import path from 'path';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((filePath: string) => !filePath.includes('HybridTurtle-v6.0')),
  };
});

const { auditScheduledTasks, parseCsvLine, parseSchtasksCsv, auditRegisterScripts, auditDatabaseBackup, EXPECTED_TASKS } = await import('./audit-scheduled-tasks.mjs');

describe('audit-scheduled-tasks.mjs', () => {
  it('parses schtasks CSV rows with quoted commands', () => {
    const output = '"TaskName","Task To Run","Start In"\r\n"\\HybridTurtle-Scan","C:\\Repo\\auto-trade-task.bat scan --scheduled","C:\\Repo"\r\n';

    expect(parseSchtasksCsv(output)).toEqual([
      {
        TaskName: '\\HybridTurtle-Scan',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat scan --scheduled',
        'Start In': 'C:\\Repo',
      },
    ]);
  });

  it('handles escaped quotes inside a CSV field', () => {
    expect(parseCsvLine('"cmd.exe /c ""C:\\Repo\\task.bat"" --scheduled","Ready"')).toEqual([
      'cmd.exe /c "C:\\Repo\\task.bat" --scheduled',
      'Ready',
    ]);
  });

  it('flags stale missing paths and untracked HybridTurtle tasks', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle Intraday Alert',
        'Task To Run': 'cmd.exe /c "C:\\HybridTurtle-v6.0\\intraday-alert-task.bat" --scheduled',
        'Start In': 'C:\\HybridTurtle-v6.0',
        'Scheduled Task State': 'Enabled',
        'Last Result': '-2147024629',
      },
    ], { repoRoot: 'C:\\Repo', expectedTasks: [], retiredTasks: [] });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'MISSING_TARGET_PATH', severity: 'ERROR' }),
      expect.objectContaining({ reason: 'UNTRACKED_HYBRIDTURTLE_TASK', severity: 'WARNING' }),
      expect.objectContaining({ reason: 'NON_ZERO_LAST_RESULT', severity: 'WARNING' }),
    ]));
  });

  it('downgrades missing target paths for disabled retired tasks', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle Intraday Alert',
        'Task To Run': 'cmd.exe /c "C:\\HybridTurtle-v6.0\\intraday-alert-task.bat" --scheduled',
        'Start In': 'C:\\HybridTurtle-v6.0',
        'Scheduled Task State': 'Disabled',
        'Last Result': '-2147024629',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [],
      retiredTasks: [{ name: 'HybridTurtle Intraday Alert', reason: 'retired legacy task' }],
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'RETIRED_TASK_DISABLED', severity: 'WARNING' }),
      expect.objectContaining({ reason: 'MISSING_TARGET_PATH', severity: 'WARNING' }),
    ]));
    expect(findings.some((finding) => finding.severity === 'ERROR')).toBe(false);
  });

  it('fails when a retired task is still enabled', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle Intraday Alert',
        'Task To Run': 'cmd.exe /c "C:\\HybridTurtle-v6.0\\intraday-alert-task.bat" --scheduled',
        'Start In': 'C:\\HybridTurtle-v6.0',
        'Scheduled Task State': 'Enabled',
        'Last Result': '0',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [],
      retiredTasks: [{ name: 'HybridTurtle Intraday Alert', reason: 'retired legacy task' }],
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'RETIRED_TASK_ENABLED', severity: 'ERROR' }),
      expect.objectContaining({ reason: 'MISSING_TARGET_PATH', severity: 'ERROR' }),
    ]));
  });

  it('passes expected current-repo tasks with valid command arguments', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle-Trade-UK',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat uk --scheduled',
        'Start In': 'C:\\Repo',
        'Scheduled Task State': 'Enabled',
        'Last Result': '0',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [{ name: 'HybridTurtle-Trade-UK', requiredPath: 'auto-trade-task.bat', requiredArgument: 'uk' }],
    });

    expect(findings).toEqual([]);
  });

  it('does not warn on N/A Start In when the action path is absolute and valid', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle-Scan',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat scan --scheduled',
        'Start In': 'N/A',
        'Scheduled Task State': 'Enabled',
        'Last Result': '0',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [{ name: 'HybridTurtle-Scan', requiredPath: 'auto-trade-task.bat', requiredArgument: 'scan' }],
    });

    expect(findings).toEqual([]);
  });

  it('does not warn when a task is currently running', () => {
    const findings = auditScheduledTasks([
      {
        TaskName: '\\HybridTurtle-Trade-US',
        'Task To Run': 'C:\\Repo\\auto-trade-task.bat us --scheduled',
        'Start In': 'N/A',
        'Scheduled Task State': 'Running',
        'Last Result': '267009',
      },
    ], {
      repoRoot: 'C:\\Repo',
      expectedTasks: [{ name: 'HybridTurtle-Trade-US', requiredPath: 'auto-trade-task.bat', requiredArgument: 'us' }],
    });

    expect(findings).toEqual([]);
  });
});

describe('auditRegisterScripts', () => {
  const expectedTasks = [
    { name: 'HybridTurtle Nightly', requiredPath: 'nightly-task.bat', registerScript: 'register-nightly-task.bat' },
    { name: 'HybridTurtle-ResearchRefresh', requiredPath: 'research-refresh-task.bat', registerScript: 'scripts/register-weekly-tasks.ps1' },
  ];

  it('passes when register script exists and references task name + target', () => {
    const findings = auditRegisterScripts({
      repoRoot: 'C:\\Repo',
      expectedTasks,
      existsSync: () => true,
      readFile: (p: string) => p.endsWith('register-nightly-task.bat')
        ? '"HybridTurtle Nightly" /tr "%~dp0nightly-task.bat"'
        : '"HybridTurtle-ResearchRefresh" /TR "$root\\research-refresh-task.bat" --scheduled',
    });

    expect(findings).toEqual([]);
  });

  it('flags missing register scripts as ERROR', () => {
    const findings = auditRegisterScripts({
      repoRoot: 'C:\\Repo',
      expectedTasks,
      existsSync: () => false,
      readFile: () => '',
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'REGISTER_SCRIPT_MISSING', severity: 'ERROR', taskName: 'HybridTurtle Nightly' }),
      expect.objectContaining({ reason: 'REGISTER_SCRIPT_MISSING', severity: 'ERROR', taskName: 'HybridTurtle-ResearchRefresh' }),
    ]));
  });

  it('flags register script that omits the task name', () => {
    const findings = auditRegisterScripts({
      repoRoot: 'C:\\Repo',
      expectedTasks: [expectedTasks[0]],
      existsSync: () => true,
      readFile: () => 'no task name here',
    });

    expect(findings).toEqual([
      expect.objectContaining({ reason: 'REGISTER_SCRIPT_TASK_NAME_NOT_FOUND', severity: 'ERROR' }),
    ]);
  });

  it('warns when target bat is not referenced in register script', () => {
    const findings = auditRegisterScripts({
      repoRoot: 'C:\\Repo',
      expectedTasks: [expectedTasks[0]],
      existsSync: () => true,
      readFile: () => '"HybridTurtle Nightly"',
    });

    expect(findings).toEqual([
      expect.objectContaining({ reason: 'REGISTER_SCRIPT_TARGET_NOT_REFERENCED', severity: 'WARNING' }),
    ]);
  });

  it('warns when manifest entry has no registerScript', () => {
    const findings = auditRegisterScripts({
      repoRoot: 'C:\\Repo',
      expectedTasks: [{ name: 'HybridTurtle Orphan', requiredPath: 'orphan.bat' }],
      existsSync: () => true,
      readFile: () => '',
    });

    expect(findings).toEqual([
      expect.objectContaining({ reason: 'MANIFEST_MISSING_REGISTER_SCRIPT', severity: 'WARNING' }),
    ]);
  });
});

describe('auditDatabaseBackup', () => {
  const nowMs = new Date('2026-04-30T12:00:00Z').getTime();

  it('passes when newest backup is within max age', () => {
    const findings = auditDatabaseBackup({
      backupDir: 'C:\\Repo\\prisma\\backups',
      nowMs,
      maxAgeHours: 48,
      existsSync: () => true,
      readdirSync: () => ['dev.db.backup-2026-04-30-0900', 'dev.db.stable-2026-04-29'],
      statSync: (p: string) => ({
        mtimeMs: p.includes('2026-04-30') ? new Date('2026-04-30T09:00:00Z').getTime() : 0,
      }),
    });

    expect(findings).toEqual([]);
  });

  it('flags ERROR when newest backup is older than max age', () => {
    const findings = auditDatabaseBackup({
      backupDir: 'C:\\Repo\\prisma\\backups',
      nowMs,
      maxAgeHours: 48,
      existsSync: () => true,
      readdirSync: () => ['dev.db.backup-2026-04-27-2200'],
      statSync: () => ({ mtimeMs: new Date('2026-04-27T22:00:00Z').getTime() }),
    });

    expect(findings).toEqual([
      expect.objectContaining({ reason: 'BACKUP_STALE', severity: 'ERROR', taskName: 'db-backup' }),
    ]);
  });

  it('flags ERROR when no managed backups exist', () => {
    const findings = auditDatabaseBackup({
      backupDir: 'C:\\Repo\\prisma\\backups',
      nowMs,
      existsSync: () => true,
      readdirSync: () => ['dev.db.stable-2026-04-29'],
      statSync: () => ({ mtimeMs: 0 }),
    });

    expect(findings).toEqual([
      expect.objectContaining({ reason: 'NO_NIGHTLY_BACKUP', severity: 'ERROR' }),
    ]);
  });

  it('warns when backup dir does not exist', () => {
    const findings = auditDatabaseBackup({
      backupDir: 'C:\\Repo\\prisma\\backups',
      nowMs,
      existsSync: () => false,
      readdirSync: () => [],
      statSync: () => ({ mtimeMs: 0 }),
    });

    expect(findings).toEqual([
      expect.objectContaining({ reason: 'BACKUP_DIR_MISSING', severity: 'WARNING' }),
    ]);
  });
});

describe('EXPECTED_TASKS manifest integrity', () => {
  // Resolve repo root from this test file location: scripts/audit-scheduled-tasks.test.ts
  const repoRoot = path.resolve(__dirname, '..');

  it.each(EXPECTED_TASKS as Array<{ name: string; requiredPath: string; registerScript?: string }>)(
    '$name has a registerScript file that exists on disk',
    (task) => {
      expect(task.registerScript, `${task.name} is missing registerScript field`).toBeTruthy();
      const scriptPath = path.join(repoRoot, task.registerScript!);
      expect(realExistsSync(scriptPath), `Register script not found: ${task.registerScript}`).toBe(true);
    },
  );

  it.each(EXPECTED_TASKS as Array<{ name: string; requiredPath: string }>)(
    '$name target .bat exists on disk: $requiredPath',
    (task) => {
      const targetPath = path.join(repoRoot, task.requiredPath);
      expect(realExistsSync(targetPath), `Target not found: ${task.requiredPath}`).toBe(true);
    },
  );
});