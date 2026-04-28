/**
 * DEPENDENCIES
 * Consumed by: monday-briefing.ts, uk-briefing.ts, us-briefing.ts, telegram-commands.ts
 * Consumes: prisma.ts, market-data.ts, risk-gates.ts, market-holidays.ts, uk-time.ts
 * Risk-sensitive: NO — read-only data gathering
 * Notes: Shared data-gathering logic for all briefing scripts.
 *        Eliminates duplication of regime/budget/candidate fetch code.
 */

import prisma from '@/lib/prisma';
import { getMarketRegime } from '@/lib/market-data';
import { getRiskBudget } from '@/lib/risk-gates';
import type { RiskProfileType, Sleeve } from '@/types';
import { getUKHour, getUKDateString, getUKTimeString } from '@/lib/uk-time';
import { isTodayMarketHoliday, isEarlyCloseDay, getMarketHoliday } from '@/lib/market-holidays';

export type SessionType = 'pre-UK' | 'UK' | 'US' | 'post-market';

export interface BriefingContext {
  session: SessionType;
  ukTimeString: string;
  regime: string;
  health: string | null;
  operatingMode: string;
  equity: number;
  riskProfile: RiskProfileType;
  usedRiskPct: number;
  maxRiskPct: number;
  availableRiskPct: number;
  usedPositions: number;
  maxPositions: number;
  openPositions: Array<{ ticker: string; sleeve: string; entryPrice: number; currentStop: number; shares: number }>;
  candidates: Array<{ ticker: string; price: number; entryTrigger: number; sleeve: string; rankScore: number }>;
  isHoliday: boolean;
  holidayLabel?: string;
  earlyClose?: string;
  tomorrowEarlyClose?: string;
}

/**
 * Gather all data needed for any briefing message.
 * Caller specifies which market's candidates to filter (UK = .L, US = non-.L, or all).
 */
export async function gatherBriefingContext(options: {
  userId?: string;
  market?: 'UK' | 'US' | 'all';
} = {}): Promise<BriefingContext> {
  const userId = options.userId ?? 'default-user';
  const market = options.market ?? 'all';

  const ukHour = getUKHour();
  const session: SessionType = ukHour < 8 ? 'pre-UK' : ukHour < 14 ? 'UK' : ukHour < 20 ? 'US' : 'post-market';

  const [user, regime, positions, latestHealth, latestScan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { riskProfile: true, equity: true, operatingMode: true },
    }),
    getMarketRegime().catch(() => 'UNKNOWN' as string),
    prisma.position.findMany({
      where: { userId, status: 'OPEN' },
      include: { stock: { select: { ticker: true, sleeve: true } } },
    }),
    prisma.healthCheck.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { overall: true },
    }),
    prisma.scan.findFirst({
      where: { userId },
      orderBy: { runDate: 'desc' },
      select: { id: true },
    }),
  ]);

  const equity = user?.equity || 0;
  const riskProfile = (user?.riskProfile || 'BALANCED') as RiskProfileType;
  const operatingMode = user?.operatingMode || 'NORMAL';

  const budget = getRiskBudget(
    positions.map(p => ({
      id: p.id,
      ticker: p.stock.ticker,
      sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
      sector: 'Unknown',
      cluster: 'General',
      value: p.shares * p.entryPrice,
      riskDollars: p.shares * (p.entryPrice - p.currentStop),
      shares: p.shares,
      entryPrice: p.entryPrice,
      currentStop: p.currentStop,
      currentPrice: p.entryPrice,
    })),
    equity,
    riskProfile
  );

  // Filter candidates by market
  const tickerFilter = market === 'UK'
    ? { endsWith: '.L' }
    : market === 'US'
      ? { not: { endsWith: '.L' } }
      : undefined;

  const candidates = latestScan
    ? await prisma.scanResult.findMany({
        where: {
          status: 'READY',
          scanId: latestScan.id,
          ...(tickerFilter ? { stock: { ticker: tickerFilter } } : {}),
        },
        select: {
          entryTrigger: true,
          price: true,
          rankScore: true,
          stock: { select: { ticker: true, sleeve: true } },
        },
        orderBy: { rankScore: 'desc' },
        take: 8,
      })
    : [];

  const { isHoliday, holiday } = isTodayMarketHoliday();
  const earlyClose = isEarlyCloseDay() ?? undefined;

  // Check tomorrow for early-close (used by nightly briefing)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const tomorrowEarlyClose = isEarlyCloseDay(tomorrowStr) ?? undefined;

  return {
    session,
    ukTimeString: getUKTimeString(),
    regime,
    health: latestHealth?.overall ?? null,
    operatingMode,
    equity,
    riskProfile,
    usedRiskPct: budget.usedRiskPercent,
    maxRiskPct: budget.maxRiskPercent,
    availableRiskPct: budget.availableRiskPercent,
    usedPositions: budget.usedPositions,
    maxPositions: budget.maxPositions,
    openPositions: positions.map(p => ({
      ticker: p.stock.ticker,
      sleeve: p.stock.sleeve || 'CORE',
      entryPrice: p.entryPrice,
      currentStop: p.currentStop,
      shares: p.shares,
    })),
    candidates: candidates.map(c => ({
      ticker: c.stock.ticker,
      price: c.price,
      entryTrigger: c.entryTrigger,
      sleeve: c.stock.sleeve || 'CORE',
      rankScore: c.rankScore,
    })),
    isHoliday: !!isHoliday,
    holidayLabel: holiday?.label,
    earlyClose,
    tomorrowEarlyClose,
  };
}
