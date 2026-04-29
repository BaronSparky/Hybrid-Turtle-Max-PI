/**
 * Prediction Engine Readiness Gate
 *
 * Determines whether the prediction engine has enough closed trade data
 * to produce meaningful calibration. Until the threshold is met, all
 * prediction modules operate in shadow mode (display-only, no execution impact).
 *
 * Consumed by: nightly.ts, /api/system-status, prediction modules
 * Consumes: prisma.ts
 * Risk-sensitive: NO — gates advisory modules only
 */

/** Minimum closed trades needed before prediction calibration is meaningful */
export const MIN_CLOSED_TRADES_FOR_CALIBRATION = 30;

/** Minimum closed trades for basic statistical significance */
export const MIN_CLOSED_TRADES_FOR_STATS = 10;

export type PredictionReadiness =
  | 'NO_DATA'           // 0 closed trades
  | 'INSUFFICIENT'      // 1-9 closed trades
  | 'EARLY_SIGNAL'      // 10-29 closed trades — basic stats possible
  | 'CALIBRATION_READY' // 30+ closed trades — full calibration
  ;

export interface PredictionReadinessResult {
  readiness: PredictionReadiness;
  closedTrades: number;
  tradesNeeded: number;
  message: string;
  canCalibrate: boolean;
  canComputeBasicStats: boolean;
}

/**
 * Check prediction engine readiness based on closed trade count.
 * Pure function — caller supplies the count.
 */
export function assessPredictionReadiness(closedTradeCount: number): PredictionReadinessResult {
  if (closedTradeCount <= 0) {
    return {
      readiness: 'NO_DATA',
      closedTrades: 0,
      tradesNeeded: MIN_CLOSED_TRADES_FOR_CALIBRATION,
      message: 'No closed trades yet. Prediction engine in shadow mode.',
      canCalibrate: false,
      canComputeBasicStats: false,
    };
  }

  if (closedTradeCount < MIN_CLOSED_TRADES_FOR_STATS) {
    return {
      readiness: 'INSUFFICIENT',
      closedTrades: closedTradeCount,
      tradesNeeded: MIN_CLOSED_TRADES_FOR_CALIBRATION - closedTradeCount,
      message: `${closedTradeCount} closed trade${closedTradeCount === 1 ? '' : 's'}. Need ${MIN_CLOSED_TRADES_FOR_STATS} for basic stats.`,
      canCalibrate: false,
      canComputeBasicStats: false,
    };
  }

  if (closedTradeCount < MIN_CLOSED_TRADES_FOR_CALIBRATION) {
    return {
      readiness: 'EARLY_SIGNAL',
      closedTrades: closedTradeCount,
      tradesNeeded: MIN_CLOSED_TRADES_FOR_CALIBRATION - closedTradeCount,
      message: `${closedTradeCount} closed trades. Basic stats available. Need ${MIN_CLOSED_TRADES_FOR_CALIBRATION} for full calibration.`,
      canCalibrate: false,
      canComputeBasicStats: true,
    };
  }

  return {
    readiness: 'CALIBRATION_READY',
    closedTrades: closedTradeCount,
    tradesNeeded: 0,
    message: `${closedTradeCount} closed trades. Prediction engine calibration ready.`,
    canCalibrate: true,
    canComputeBasicStats: true,
  };
}

/**
 * Get prediction readiness from the database.
 * Queries closed position count and returns readiness assessment.
 */
export async function getPredictionReadiness(): Promise<PredictionReadinessResult> {
  const { default: prisma } = await import('../prisma');
  const closedCount = await prisma.position.count({ where: { status: 'CLOSED' } });
  return assessPredictionReadiness(closedCount);
}
