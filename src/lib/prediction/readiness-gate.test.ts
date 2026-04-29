import { describe, it, expect } from 'vitest';
import {
  assessPredictionReadiness,
  MIN_CLOSED_TRADES_FOR_CALIBRATION,
  MIN_CLOSED_TRADES_FOR_STATS,
} from './readiness-gate';

describe('assessPredictionReadiness', () => {
  it('returns NO_DATA for 0 closed trades', () => {
    const result = assessPredictionReadiness(0);
    expect(result.readiness).toBe('NO_DATA');
    expect(result.canCalibrate).toBe(false);
    expect(result.canComputeBasicStats).toBe(false);
    expect(result.tradesNeeded).toBe(MIN_CLOSED_TRADES_FOR_CALIBRATION);
  });

  it('returns INSUFFICIENT for 1-9 closed trades', () => {
    const result = assessPredictionReadiness(5);
    expect(result.readiness).toBe('INSUFFICIENT');
    expect(result.canCalibrate).toBe(false);
    expect(result.canComputeBasicStats).toBe(false);
    expect(result.closedTrades).toBe(5);
  });

  it('returns EARLY_SIGNAL for 10-29 closed trades', () => {
    const result = assessPredictionReadiness(15);
    expect(result.readiness).toBe('EARLY_SIGNAL');
    expect(result.canCalibrate).toBe(false);
    expect(result.canComputeBasicStats).toBe(true);
    expect(result.tradesNeeded).toBe(15);
  });

  it('returns CALIBRATION_READY for 30+ closed trades', () => {
    const result = assessPredictionReadiness(30);
    expect(result.readiness).toBe('CALIBRATION_READY');
    expect(result.canCalibrate).toBe(true);
    expect(result.canComputeBasicStats).toBe(true);
    expect(result.tradesNeeded).toBe(0);
  });

  it('handles exact boundary at 10', () => {
    expect(assessPredictionReadiness(9).readiness).toBe('INSUFFICIENT');
    expect(assessPredictionReadiness(10).readiness).toBe('EARLY_SIGNAL');
  });

  it('handles exact boundary at 30', () => {
    expect(assessPredictionReadiness(29).readiness).toBe('EARLY_SIGNAL');
    expect(assessPredictionReadiness(30).readiness).toBe('CALIBRATION_READY');
  });

  it('handles large trade counts', () => {
    const result = assessPredictionReadiness(500);
    expect(result.readiness).toBe('CALIBRATION_READY');
    expect(result.closedTrades).toBe(500);
  });

  it('message is descriptive for each level', () => {
    expect(assessPredictionReadiness(0).message).toContain('shadow mode');
    expect(assessPredictionReadiness(5).message).toContain('5 closed trades');
    expect(assessPredictionReadiness(15).message).toContain('Basic stats');
    expect(assessPredictionReadiness(30).message).toContain('calibration ready');
  });
});
