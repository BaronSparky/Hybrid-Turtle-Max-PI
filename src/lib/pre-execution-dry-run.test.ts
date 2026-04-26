import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mock prisma before importing the module under test ──
const mockHealthCheckFindFirst = vi.fn();
const mockHeartbeatFindFirst = vi.fn();
const mockUserFindUnique = vi.fn();

vi.mock('./prisma', () => ({
  default: {
    healthCheck: { findFirst: (...args: unknown[]) => mockHealthCheckFindFirst(...args) },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    heartbeat: { findFirst: (...args: unknown[]) => mockHeartbeatFindFirst(...args) },
  },
}));

// Mock safety-controls (kill switch)
const mockGetKillSwitchSettings = vi.fn();
vi.mock('../../packages/workflow/src', () => ({
  getKillSwitchSettings: () => mockGetKillSwitchSettings(),
}));

// Mock execution-mode
vi.mock('./execution-mode', () => ({
  getCurrentExecutionMode: (regime: string) => ({
    mode: regime === 'BULLISH' ? 'PLANNED' : 'BLOCKED',
    canEnter: regime === 'BULLISH',
    reason: regime === 'BULLISH' ? 'Execution day.' : 'Blocked.',
    gates: null,
    isOpportunistic: false,
    isPlanned: regime === 'BULLISH',
  }),
}));

import { runPreExecutionDryRun, type DryRunInput } from './pre-execution-dry-run';

// ── Fixtures ─────────────────────────────────────────────────

const baseInput: DryRunInput = {
  userId: 'test-user',
  ticker: 'AAPL',
  entryPrice: 150,
  stopPrice: 140,
  quantity: 10,
  accountType: 'invest',
  regime: 'BULLISH',
};

function setupDefaults() {
  mockGetKillSwitchSettings.mockResolvedValue({
    disableAllSubmissions: false,
    disableAutomatedSubmissions: false,
    disableScansWhenDataStale: false,
    enableAutoTrading: false,
    updatedAt: null,
  });

  // Health check: GREEN, recent
  mockHealthCheckFindFirst.mockResolvedValue({
    overall: 'GREEN',
    runDate: new Date(),
  });

  // Heartbeat: recent, OK
  mockHeartbeatFindFirst.mockResolvedValue({
    timestamp: new Date(),
    status: 'OK',
    details: null,
  });

  // User with equity and T212 connected
  mockUserFindUnique.mockResolvedValue({
    equity: 10000,
    operatingMode: 'NORMAL',
    t212Connected: true,
    t212IsaConnected: false,
    t212ApiKey: 'test-key',
    t212IsaApiKey: null,
  });
}

// ── Tests ────────────────────────────────────────────────────

describe('pre-execution-dry-run', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
  });

  it('passes when all conditions are met', async () => {
    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(true);
    expect(result.decision).toBe('DRY_RUN_PASS');
    expect(result.hardFailures).toHaveLength(0);
  });

  it('fails when kill switch is active', async () => {
    mockGetKillSwitchSettings.mockResolvedValue({
      disableAllSubmissions: true,
      disableAutomatedSubmissions: false,
      disableScansWhenDataStale: false,
      enableAutoTrading: false,
      updatedAt: null,
    });

    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(false);
    expect(result.decision).toBe('DRY_RUN_FAIL');
    const killCheck = result.hardFailures.find(c => c.id === 'KILL_SWITCH');
    expect(killCheck).toBeDefined();
    expect(killCheck?.recovery).toContain('Settings');
  });

  it('fails when kill switch check throws (fail-safe)', async () => {
    mockGetKillSwitchSettings.mockRejectedValue(new Error('DB unreachable'));

    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(false);
    const killCheck = result.hardFailures.find(c => c.id === 'KILL_SWITCH');
    expect(killCheck).toBeDefined();
    expect(killCheck?.message).toContain('Blocking as a precaution');
  });

  it('fails when health is RED', async () => {
    mockHealthCheckFindFirst.mockResolvedValue({
      overall: 'RED',
      runDate: new Date(),
    });

    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(false);
    const healthCheck = result.hardFailures.find(c => c.id === 'SYSTEM_HEALTH');
    expect(healthCheck).toBeDefined();
    expect(healthCheck?.message).toContain('RED');
  });

  it('fails when equity is zero', async () => {
    mockUserFindUnique.mockResolvedValue({ equity: 0, operatingMode: 'NORMAL', t212Connected: true, t212IsaConnected: false, t212ApiKey: 'k', t212IsaApiKey: null });

    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(false);
    const equityCheck = result.hardFailures.find(c => c.id === 'EQUITY');
    expect(equityCheck).toBeDefined();
  });

  it('fails when regime is BEARISH', async () => {
    const result = await runPreExecutionDryRun({ ...baseInput, regime: 'BEARISH' });

    expect(result.passed).toBe(false);
    const regimeCheck = result.hardFailures.find(c => c.id === 'REGIME');
    expect(regimeCheck).toBeDefined();
    expect(regimeCheck?.message).toContain('BEARISH');
  });

  it('fails when stop >= entry', async () => {
    const result = await runPreExecutionDryRun({ ...baseInput, stopPrice: 160 });

    expect(result.passed).toBe(false);
    const stopCheck = result.hardFailures.find(c => c.id === 'STOP_VALIDITY');
    expect(stopCheck).toBeDefined();
    expect(stopCheck?.message).toContain('below entry');
  });

  it('fails when quantity is zero', async () => {
    const result = await runPreExecutionDryRun({ ...baseInput, quantity: 0 });

    expect(result.passed).toBe(false);
    const sizeCheck = result.hardFailures.find(c => c.id === 'POSITION_SIZE');
    expect(sizeCheck).toBeDefined();
  });

  it('fails when T212 invest not connected', async () => {
    mockUserFindUnique.mockResolvedValue({
      equity: 10000,
      operatingMode: 'NORMAL',
      t212Connected: false,
      t212IsaConnected: false,
      t212ApiKey: null,
      t212IsaApiKey: null,
    });

    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(false);
    const brokerCheck = result.hardFailures.find(c => c.id === 'BROKER');
    expect(brokerCheck).toBeDefined();
    expect(brokerCheck?.message).toContain('not connected');
  });

  it('fails when dual score is Auto-No', async () => {
    const result = await runPreExecutionDryRun({ ...baseInput, dualScoreAction: 'Auto-No', fwsScore: 75 });

    expect(result.passed).toBe(false);
    const fwsCheck = result.hardFailures.find(c => c.id === 'FWS_AUTO_NO');
    expect(fwsCheck).toBeDefined();
    expect(fwsCheck?.message).toContain('Auto-No');
  });

  it('accumulates multiple hard failures', async () => {
    mockGetKillSwitchSettings.mockResolvedValue({
      disableAllSubmissions: true,
      disableAutomatedSubmissions: false,
      disableScansWhenDataStale: false,
      enableAutoTrading: false,
      updatedAt: null,
    });
    mockUserFindUnique.mockResolvedValue({ equity: 0, operatingMode: 'NORMAL', t212Connected: true, t212IsaConnected: false, t212ApiKey: 'k', t212IsaApiKey: null });

    const result = await runPreExecutionDryRun({ ...baseInput, stopPrice: 160 });

    expect(result.passed).toBe(false);
    // Should have at least kill switch + equity + stop validity failures
    expect(result.hardFailures.length).toBeGreaterThanOrEqual(3);
  });

  it('every check has an id, label, severity, and message', async () => {
    const result = await runPreExecutionDryRun(baseInput);

    for (const check of result.checks) {
      expect(check.id).toBeTruthy();
      expect(check.label).toBeTruthy();
      expect(check.severity).toMatch(/HARD_BLOCK|SOFT_WARNING/);
      expect(check.message).toBeTruthy();
    }
  });

  it('returns 13 checks total', async () => {
    const result = await runPreExecutionDryRun(baseInput);
    expect(result.checks).toHaveLength(13);
  });

  it('soft warnings do not cause failure', async () => {
    // Heartbeat stale (26h+) is a soft warning
    const staleDate = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30 hours ago
    mockHeartbeatFindFirst.mockResolvedValue({
      timestamp: staleDate,
      status: 'OK',
      details: null,
    });

    const result = await runPreExecutionDryRun(baseInput);

    // Soft warnings should not cause failure
    expect(result.passed).toBe(true);
    expect(result.softWarnings.length).toBeGreaterThan(0);
  });

  it('fails when operating mode is CAPITAL_PRESERVATION', async () => {
    mockUserFindUnique.mockResolvedValue({
      equity: 10000,
      t212Connected: true,
      t212IsaConnected: false,
      t212ApiKey: 'test-key',
      t212IsaApiKey: null,
      operatingMode: 'CAPITAL_PRESERVATION',
    });

    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(false);
    const modeCheck = result.hardFailures.find(c => c.id === 'OPERATING_MODE');
    expect(modeCheck).toBeDefined();
    expect(modeCheck?.message).toContain('not allowed');
  });

  it('fails when operating mode is RESEARCH', async () => {
    mockUserFindUnique.mockResolvedValue({
      equity: 10000,
      t212Connected: true,
      t212IsaConnected: false,
      t212ApiKey: 'test-key',
      t212IsaApiKey: null,
      operatingMode: 'RESEARCH',
    });

    const result = await runPreExecutionDryRun(baseInput);

    expect(result.passed).toBe(false);
    const modeCheck = result.hardFailures.find(c => c.id === 'OPERATING_MODE');
    expect(modeCheck).toBeDefined();
  });

  it('passes when operating mode is NORMAL', async () => {
    const result = await runPreExecutionDryRun(baseInput);
    const modeCheck = result.checks.find(c => c.id === 'OPERATING_MODE');
    expect(modeCheck?.passed).toBe(true);
  });

  it('passes when operating mode is AGGRESSIVE_QUALITY', async () => {
    const result = await runPreExecutionDryRun({ ...baseInput, operatingMode: 'AGGRESSIVE_QUALITY' });
    const modeCheck = result.checks.find(c => c.id === 'OPERATING_MODE');
    expect(modeCheck?.passed).toBe(true);
  });
});
