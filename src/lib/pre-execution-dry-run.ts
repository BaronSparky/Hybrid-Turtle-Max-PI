/**
 * DEPENDENCIES
 * Consumed by: /api/positions/execute/route.ts, /api/positions/dry-run/route.ts
 * Consumes: health-check.ts, risk-gates.ts, execution-mode.ts, entry-quality-engine.ts, safety-controls.ts, prisma.ts
 * Risk-sensitive: YES — gates all real-money execution
 * Notes: Pre-execution dry run validates ALL safety conditions before allowing a T212 order.
 *        Returns a pass/fail result with detailed reasons. Every check is independent.
 *        Hard failures block execution entirely. Soft warnings are informational.
 */

import prisma from './prisma';
import { getCurrentExecutionMode } from './execution-mode';
import { getKillSwitchSettings } from '../../packages/workflow/src';
import { OPERATING_MODES, type OperatingMode } from '@/types';

// ── Types ────────────────────────────────────────────────────

export interface DryRunCheck {
  id: string;
  label: string;
  passed: boolean;
  severity: 'HARD_BLOCK' | 'SOFT_WARNING';
  message: string;
  recovery?: string;
}

export interface DryRunResult {
  passed: boolean;
  decision: 'DRY_RUN_PASS' | 'DRY_RUN_FAIL';
  checks: DryRunCheck[];
  hardFailures: DryRunCheck[];
  softWarnings: DryRunCheck[];
  summary: string;
}

export interface DryRunInput {
  userId: string;
  ticker: string;
  entryPrice: number;
  stopPrice: number;
  quantity: number;
  accountType: 'invest' | 'isa';
  /** Current market regime (BULLISH/SIDEWAYS/BEARISH) */
  regime?: string;
  /** Current NCS score */
  ncsScore?: number;
  /** Current FWS score */
  fwsScore?: number;
  /** Dual score action */
  dualScoreAction?: string;
  /** Operating mode override (fetched from DB if not provided) */
  operatingMode?: OperatingMode;
}

// ── Main Dry Run ─────────────────────────────────────────────

export async function runPreExecutionDryRun(input: DryRunInput): Promise<DryRunResult> {
  const checks: DryRunCheck[] = [];

  // Pre-fetch shared data once to avoid N+1 queries in the hot path
  const [userData, heartbeatData] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        equity: true,
        operatingMode: true,
        t212Connected: true,
        t212IsaConnected: true,
        t212ApiKey: true,
        t212IsaApiKey: true,
      },
    }).catch(() => null),
    prisma.heartbeat.findFirst({
      orderBy: { timestamp: 'desc' as const },
      select: { timestamp: true, details: true },
    }).catch(() => null),
  ]);

  // 1. Kill switch check
  checks.push(await checkKillSwitch());

  // 2. Health check (overall)
  checks.push(await checkSystemHealth(input.userId));

  // 3. Equity check
  checks.push(checkEquity(userData));

  // 4. Execution mode (day-based)
  checks.push(checkExecutionMode(input.regime));

  // 5. Regime check
  checks.push(checkRegime(input.regime));

  // 6. Position size validity
  checks.push(checkPositionSizeValidity(input.quantity));

  // 7. Stop validity
  checks.push(checkStopValidity(input.entryPrice, input.stopPrice));

  // 8. T212 connectivity
  checks.push(checkBrokerConnectivity(userData, input.accountType));

  // 9. Heartbeat freshness
  checks.push(checkHeartbeatFreshness(heartbeatData));

  // 10. Data freshness (last nightly run)
  checks.push(checkDataFreshness(heartbeatData));

  // 11. Backup status
  checks.push(checkBackupStatus(heartbeatData));

  // 12. FWS Auto-No check
  checks.push(checkFWSAutoNo(input.fwsScore, input.dualScoreAction));

  // 13. Operating mode check
  checks.push(checkOperatingMode(userData, input.operatingMode));

  const hardFailures = checks.filter(c => !c.passed && c.severity === 'HARD_BLOCK');
  const softWarnings = checks.filter(c => !c.passed && c.severity === 'SOFT_WARNING');
  const passed = hardFailures.length === 0;

  const summary = passed
    ? softWarnings.length > 0
      ? `Dry run PASSED with ${softWarnings.length} warning(s): ${softWarnings.map(w => w.label).join(', ')}`
      : 'Dry run PASSED — all safety checks clear.'
    : `Dry run FAILED — ${hardFailures.length} blocking issue(s): ${hardFailures.map(f => f.label).join(', ')}`;

  return {
    passed,
    decision: passed ? 'DRY_RUN_PASS' : 'DRY_RUN_FAIL',
    checks,
    hardFailures,
    softWarnings,
    summary,
  };
}

// ── Individual Checks ────────────────────────────────────────

async function checkKillSwitch(): Promise<DryRunCheck> {
  try {
    const settings = await getKillSwitchSettings();
    if (settings.disableAllSubmissions) {
      return {
        id: 'KILL_SWITCH',
        label: 'Kill Switch',
        passed: false,
        severity: 'HARD_BLOCK',
        message: 'All submissions are disabled by the kill switch.',
        recovery: 'Go to Settings → Safety Controls and disable the kill switch.',
      };
    }
    return {
      id: 'KILL_SWITCH',
      label: 'Kill Switch',
      passed: true,
      severity: 'HARD_BLOCK',
      message: 'Kill switch is off.',
    };
  } catch {
    // Safety gate: fail-closed. If we can't read the kill switch, block execution.
    return {
      id: 'KILL_SWITCH',
      label: 'Kill Switch',
      passed: false,
      severity: 'HARD_BLOCK',
      message: 'Kill switch check failed (unable to read settings). Blocking as a precaution.',
      recovery: 'Check database connectivity and restart the application.',
    };
  }
}

async function checkSystemHealth(userId: string): Promise<DryRunCheck> {
  try {
    // Use the most recent health check from DB instead of running a full check
    // to avoid expensive I/O during execution flow.
    const latest = await prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
    });

    if (!latest) {
      return {
        id: 'SYSTEM_HEALTH',
        label: 'System Health',
        passed: false,
        severity: 'SOFT_WARNING',
        message: 'No health check has been run yet. Run the nightly process first.',
        recovery: 'Run nightly or trigger a health check from the dashboard.',
      };
    }

    const ageHours = (Date.now() - latest.runDate.getTime()) / (1000 * 60 * 60);

    if (latest.overall === 'RED') {
      return {
        id: 'SYSTEM_HEALTH',
        label: 'System Health',
        passed: false,
        severity: 'HARD_BLOCK',
        message: `System health is RED (last check ${ageHours.toFixed(1)}h ago). Do not trade until resolved.`,
        recovery: 'Check the health report for RED items and resolve them.',
      };
    }

    if (ageHours > 36) {
      return {
        id: 'SYSTEM_HEALTH',
        label: 'System Health',
        passed: false,
        severity: 'SOFT_WARNING',
        message: `Health check is ${ageHours.toFixed(0)}h old — may be stale.`,
        recovery: 'Run the nightly process to refresh the health check.',
      };
    }

    return {
      id: 'SYSTEM_HEALTH',
      label: 'System Health',
      passed: true,
      severity: 'HARD_BLOCK',
      message: `System health is ${latest.overall} (${ageHours.toFixed(1)}h ago).`,
    };
  } catch {
    return {
      id: 'SYSTEM_HEALTH',
      label: 'System Health',
      passed: false,
      severity: 'SOFT_WARNING',
      message: 'Unable to check system health.',
      recovery: 'Run the nightly process.',
    };
  }
}

interface UserData {
  equity: number;
  operatingMode: string | null;
  t212Connected: boolean;
  t212IsaConnected: boolean;
  t212ApiKey: string | null;
  t212IsaApiKey: string | null;
}

function checkEquity(user: UserData | null): DryRunCheck {
  if (!user || user.equity <= 0) {
    return {
      id: 'EQUITY',
      label: 'Account Equity',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Equity is ${user?.equity ?? 'unknown'}. Must be positive.`,
      recovery: 'Set your account equity in Settings.',
    };
  }

  return {
    id: 'EQUITY',
    label: 'Account Equity',
    passed: true,
    severity: 'HARD_BLOCK',
    message: `Equity: £${user.equity.toFixed(2)}`,
  };
}

function checkExecutionMode(regime?: string): DryRunCheck {
  const mode = getCurrentExecutionMode(regime || 'UNKNOWN');

  if (!mode.canEnter) {
    return {
      id: 'EXECUTION_MODE',
      label: 'Execution Mode',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `${mode.mode}: ${mode.reason}`,
      recovery: mode.mode === 'PLANNING'
        ? 'Planning day. Markets reopen on Monday.'
        : 'Wait for a valid execution day.',
    };
  }

  return {
    id: 'EXECUTION_MODE',
    label: 'Execution Mode',
    passed: true,
    severity: 'HARD_BLOCK',
    message: `${mode.mode}: ${mode.reason}`,
  };
}

function checkRegime(regime?: string): DryRunCheck {
  if (!regime || regime === 'UNKNOWN') {
    return {
      id: 'REGIME',
      label: 'Market Regime',
      passed: false,
      severity: 'SOFT_WARNING',
      message: 'Market regime is unknown. Run a scan to detect regime.',
      recovery: 'Run a scan or check the regime detector.',
    };
  }

  if (regime !== 'BULLISH') {
    return {
      id: 'REGIME',
      label: 'Market Regime',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Regime is ${regime}. New entries require BULLISH regime.`,
      recovery: 'Wait for regime to shift to BULLISH.',
    };
  }

  return {
    id: 'REGIME',
    label: 'Market Regime',
    passed: true,
    severity: 'HARD_BLOCK',
    message: 'Regime is BULLISH.',
  };
}

function checkPositionSizeValidity(quantity: number): DryRunCheck {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return {
      id: 'POSITION_SIZE',
      label: 'Position Size',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Quantity ${quantity} is invalid. Must be a positive number.`,
      recovery: 'Recalculate position size.',
    };
  }

  return {
    id: 'POSITION_SIZE',
    label: 'Position Size',
    passed: true,
    severity: 'HARD_BLOCK',
    message: `Quantity: ${quantity}`,
  };
}

function checkStopValidity(entryPrice: number, stopPrice: number): DryRunCheck {
  if (stopPrice <= 0) {
    return {
      id: 'STOP_VALIDITY',
      label: 'Stop-Loss',
      passed: false,
      severity: 'HARD_BLOCK',
      message: 'Stop price must be > 0.',
      recovery: 'Set a valid stop-loss price.',
    };
  }

  if (stopPrice >= entryPrice) {
    return {
      id: 'STOP_VALIDITY',
      label: 'Stop-Loss',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Stop (${stopPrice}) must be below entry (${entryPrice}).`,
      recovery: 'Recalculate stop-loss — it must be below the entry price.',
    };
  }

  return {
    id: 'STOP_VALIDITY',
    label: 'Stop-Loss',
    passed: true,
    severity: 'HARD_BLOCK',
    message: `Stop: ${stopPrice.toFixed(4)} (below entry ${entryPrice.toFixed(4)}).`,
  };
}

function checkBrokerConnectivity(user: UserData | null, accountType: 'invest' | 'isa'): DryRunCheck {
  if (!user) {
    return {
      id: 'BROKER',
      label: 'Broker Connectivity',
      passed: false,
      severity: 'HARD_BLOCK',
      message: 'User not found.',
      recovery: 'Check user configuration.',
    };
  }

  if (accountType === 'isa') {
    if (!user.t212IsaConnected || !user.t212IsaApiKey) {
      return {
        id: 'BROKER',
        label: 'Broker Connectivity',
        passed: false,
        severity: 'HARD_BLOCK',
        message: 'T212 ISA account not connected.',
        recovery: 'Go to Settings → Broker and add your ISA API credentials.',
      };
    }
  } else {
    if (!user.t212Connected || !user.t212ApiKey) {
      return {
        id: 'BROKER',
        label: 'Broker Connectivity',
        passed: false,
        severity: 'HARD_BLOCK',
        message: 'T212 Invest account not connected.',
        recovery: 'Go to Settings → Broker and add your Invest API credentials.',
      };
    }
  }

  return {
    id: 'BROKER',
    label: 'Broker Connectivity',
    passed: true,
    severity: 'HARD_BLOCK',
    message: `T212 ${accountType.toUpperCase()} connected.`,
  };
}

interface HeartbeatData {
  timestamp: Date;
  details: string | null;
}

function checkHeartbeatFreshness(heartbeat: HeartbeatData | null): DryRunCheck {
  if (!heartbeat) {
    return {
      id: 'HEARTBEAT',
      label: 'Heartbeat',
      passed: false,
      severity: 'SOFT_WARNING',
      message: 'No heartbeat recorded. Run the nightly process.',
      recovery: 'Run the nightly process to establish a heartbeat.',
    };
  }

  const ageHours = (Date.now() - heartbeat.timestamp.getTime()) / (1000 * 60 * 60);

  if (ageHours > 26) {
    return {
      id: 'HEARTBEAT',
      label: 'Heartbeat',
      passed: false,
      severity: 'SOFT_WARNING',
      message: `Heartbeat is ${ageHours.toFixed(0)}h old (threshold: 26h). Nightly may not have run.`,
      recovery: 'Run the nightly process.',
    };
  }

  return {
    id: 'HEARTBEAT',
    label: 'Heartbeat',
    passed: true,
    severity: 'SOFT_WARNING',
    message: `Heartbeat: ${ageHours.toFixed(1)}h ago.`,
  };
}

function checkDataFreshness(heartbeat: HeartbeatData | null): DryRunCheck {
  if (!heartbeat) {
    return {
      id: 'DATA_FRESHNESS',
      label: 'Data Freshness',
      passed: false,
      severity: 'SOFT_WARNING',
      message: 'No data refresh recorded.',
      recovery: 'Run the nightly process to refresh market data.',
    };
  }

  const ageHours = (Date.now() - heartbeat.timestamp.getTime()) / (1000 * 60 * 60);
  const ageDays = ageHours / 24;

  if (ageDays > 5) {
    return {
      id: 'DATA_FRESHNESS',
      label: 'Data Freshness',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Market data is ${ageDays.toFixed(1)} days old. Too stale for safe execution.`,
      recovery: 'Run the nightly process to refresh data.',
    };
  }

  if (ageDays > 2) {
    return {
      id: 'DATA_FRESHNESS',
      label: 'Data Freshness',
      passed: false,
      severity: 'SOFT_WARNING',
      message: `Market data is ${ageDays.toFixed(1)} days old.`,
      recovery: 'Run the nightly process to refresh data.',
    };
  }

  return {
    id: 'DATA_FRESHNESS',
    label: 'Data Freshness',
    passed: true,
    severity: 'SOFT_WARNING',
    message: `Data refreshed ${ageHours.toFixed(1)}h ago.`,
  };
}

function checkBackupStatus(heartbeat: HeartbeatData | null): DryRunCheck {
  if (!heartbeat) {
    return {
      id: 'BACKUP',
      label: 'Database Backup',
      passed: false,
      severity: 'SOFT_WARNING',
      message: 'No backup status available.',
      recovery: 'Run the nightly process (includes backup).',
    };
  }

  const ageHours = (Date.now() - heartbeat.timestamp.getTime()) / (1000 * 60 * 60);

  if (ageHours > 48) {
    return {
      id: 'BACKUP',
      label: 'Database Backup',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Last nightly (incl. backup) was ${ageHours.toFixed(0)}h ago — execution blocked.`,
      recovery: 'Run the nightly process to create a fresh backup before trading.',
    };
  }

  return {
    id: 'BACKUP',
    label: 'Database Backup',
    passed: true,
    severity: 'SOFT_WARNING',
    message: `Nightly backup: ${ageHours.toFixed(1)}h ago.`,
  };
}

function checkFWSAutoNo(fwsScore?: number, dualScoreAction?: string): DryRunCheck {
  if (dualScoreAction === 'Auto-No') {
    return {
      id: 'FWS_AUTO_NO',
      label: 'Fatal Weakness',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Dual score action is Auto-No (FWS: ${fwsScore ?? 'unknown'}). Candidate is too fragile.`,
      recovery: 'Choose a different candidate with lower Fatal Weakness Score.',
    };
  }

  if (fwsScore != null && fwsScore > 65) {
    return {
      id: 'FWS_AUTO_NO',
      label: 'Fatal Weakness',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `FWS is ${fwsScore} (> 65 threshold). Candidate is too fragile.`,
      recovery: 'Choose a different candidate with lower Fatal Weakness Score.',
    };
  }

  return {
    id: 'FWS_AUTO_NO',
    label: 'Fatal Weakness',
    passed: true,
    severity: 'HARD_BLOCK',
    message: fwsScore != null ? `FWS: ${fwsScore} (within bounds).` : 'FWS check skipped (no score provided).',
  };
}

function checkOperatingMode(user: UserData | null, modeOverride?: OperatingMode): DryRunCheck {
  const mode: OperatingMode = modeOverride || (user?.operatingMode as OperatingMode) || 'NORMAL';

  const config = OPERATING_MODES[mode];
  if (!config) {
    return {
      id: 'OPERATING_MODE',
      label: 'Operating Mode',
      passed: true,
      severity: 'HARD_BLOCK',
      message: `Unknown mode "${mode}" — defaulting to NORMAL.`,
    };
  }

  if (!config.canBuy) {
    return {
      id: 'OPERATING_MODE',
      label: 'Operating Mode',
      passed: false,
      severity: 'HARD_BLOCK',
      message: `Operating mode is ${config.name} — new entries are not allowed.`,
      recovery: 'Switch to Normal or Aggressive Quality mode in Settings to resume trading.',
    };
  }

  return {
    id: 'OPERATING_MODE',
    label: 'Operating Mode',
    passed: true,
    severity: 'HARD_BLOCK',
    message: `Mode: ${config.name}.`,
  };
}
