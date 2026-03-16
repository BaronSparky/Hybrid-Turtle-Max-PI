export interface SignalBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TrendAnalysis {
  sma20: number;
  sma55: number;
  ema21: number;
  slope20: number;
  trendScore: number;
  isUptrend: boolean;
  reasons: string[];
  warnings: string[];
}

export interface BreakoutAnalysis {
  currentPrice: number;
  triggerPrice: number;
  breakoutHigh20: number;
  breakoutHigh55: number;
  volumeRatio20: number;
  breakoutDistancePct: number;
  setupStatus: 'READY_NEXT_SESSION' | 'READY_ON_TRIGGER' | 'EARLY_BIRD' | 'WATCH' | 'WAIT_PULLBACK' | 'AVOID';
  reasons: string[];
  warnings: string[];
}

export interface RiskFilterAnalysis {
  atr14: number;
  initialStop: number;
  riskPerShare: number;
  stopDistancePercent: number;
  passes: boolean;
  warnings: string[];
}

export interface RankedCandidate {
  symbol: string;
  currentPrice: number;
  triggerPrice: number;
  initialStop: number;
  stopDistancePercent: number;
  riskPerShare: number;
  setupStatus: BreakoutAnalysis['setupStatus'];
  rankScore: number;
  reasons: string[];
  warnings: string[];
}

export interface SignalScanResult {
  signalRunId: string;
  scannedSymbols: number;
  staleSymbols: number;
  candidates: RankedCandidate[];
}

export interface CandidateListView {
  signalRunId: string;
  sortBy: 'rankScore' | 'symbol' | 'currentPrice' | 'triggerPrice' | 'stopDistancePercent' | 'setupStatus';
  direction: 'asc' | 'desc';
  totalCandidates: number;
  items: RankedCandidate[];
}