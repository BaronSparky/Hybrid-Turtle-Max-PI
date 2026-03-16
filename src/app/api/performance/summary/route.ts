export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { apiError } from '@/lib/api-response';

/**
 * DEPENDENCIES
 * Consumed by: /performance page
 * Consumes: prisma.ts, api-response.ts
 * Risk-sensitive: NO — read-only, no DB writes
 * Last modified: 2026-03-01
 * Notes: Degrades gracefully with nulls when data is insufficient
 */

// GET /api/performance/summary — account performance overview
export async function GET() {
  try {
    // Equity curve + starting/current equity
    const snapshots = await prisma.equitySnapshot.findMany({
      orderBy: { capturedAt: 'asc' },
      select: { equity: true, capturedAt: true },
    });

    // Use startingEquityOverride from user settings if set (explicit user value),
    // otherwise fall back to the earliest snapshot
    const user = await prisma.user.findUnique({
      where: { id: 'default-user' },
      select: { startingEquityOverride: true },
    });

    const startingEquity = user?.startingEquityOverride
      ?? (snapshots.length > 0 ? snapshots[0].equity : null);
    const currentEquity = snapshots.length > 0 ? snapshots[snapshots.length - 1].equity : null;
    const totalGainLoss =
      startingEquity != null && currentEquity != null
        ? currentEquity - startingEquity
        : null;
    const totalGainLossPct =
      startingEquity != null && startingEquity > 0 && totalGainLoss != null
        ? (totalGainLoss / startingEquity) * 100
        : null;

    // Weeks running — from first snapshot to now
    const weeksRunning =
      snapshots.length > 0
        ? Math.max(
            1,
            Math.floor(
              (Date.now() - new Date(snapshots[0].capturedAt).getTime()) /
                (7 * 24 * 60 * 60 * 1000)
            )
          )
        : 0;

    const equityCurve = snapshots.map((s) => ({
      date: s.capturedAt.toISOString().slice(0, 10),
      value: s.equity,
    }));

    // Closed trade stats — use Position.realisedPnlGbp as primary source,
    // fall back to TradeLog for positions closed before the realisedPnlGbp field existed
    const closedPositions = await prisma.position.findMany({
      where: { status: 'CLOSED' },
      select: {
        id: true,
        exitPrice: true,
        exitDate: true,
        exitReason: true,
        entryPrice: true,
        shares: true,
        entryDate: true,
        realisedPnlGbp: true,
        realisedPnlR: true,
        closedBy: true,
        stock: { select: { ticker: true } },
      },
      orderBy: { exitDate: 'desc' },
    });

    // Also pull TradeLog for positions without realisedPnlGbp (legacy closes)
    const closedTrades = await prisma.tradeLog.findMany({
      where: {
        tradeType: { in: ['CLOSE', 'EXIT', 'STOP_HIT'] },
        gainLossGbp: { not: null },
      },
      select: {
        positionId: true,
        ticker: true,
        gainLossGbp: true,
        tradeDate: true,
        daysHeld: true,
        exitReason: true,
      },
      orderBy: { tradeDate: 'desc' },
    });

    // Build unified closed trade list — prefer Position data, fall back to TradeLog
    const tradeLogByPosition = new Map(
      closedTrades.filter(t => t.positionId).map(t => [t.positionId!, t])
    );

    interface ClosedTradeRow {
      ticker: string;
      gainLoss: number;
      exitReason: string | null;
      daysHeld: number | null;
      tradeDate: string;
    }

    const unifiedTrades: ClosedTradeRow[] = closedPositions.map((pos) => {
      const logEntry = tradeLogByPosition.get(pos.id);
      const daysHeld = pos.exitDate
        ? Math.floor((new Date(pos.exitDate).getTime() - new Date(pos.entryDate).getTime()) / 86400000)
        : logEntry?.daysHeld ?? null;

      return {
        ticker: pos.stock.ticker,
        gainLoss: pos.realisedPnlGbp ?? logEntry?.gainLossGbp ?? 0,
        exitReason: pos.exitReason ?? logEntry?.exitReason ?? null,
        daysHeld,
        tradeDate: (pos.exitDate ?? new Date()).toISOString().slice(0, 10),
      };
    });

    // Include TradeLog entries that don't have a matching Position (unlikely but safe)
    const positionIds = new Set(closedPositions.map(p => p.id));
    for (const t of closedTrades) {
      if (t.positionId && positionIds.has(t.positionId)) continue; // Already counted
      unifiedTrades.push({
        ticker: t.ticker,
        gainLoss: t.gainLossGbp ?? 0,
        exitReason: t.exitReason ?? null,
        daysHeld: t.daysHeld ?? null,
        tradeDate: t.tradeDate.toISOString().slice(0, 10),
      });
    }

    const totalTrades = unifiedTrades.length;
    const winningTrades = unifiedTrades.filter((t) => t.gainLoss > 0).length;
    const losingTrades = unifiedTrades.filter((t) => t.gainLoss <= 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : null;

    let bestTrade: { ticker: string; gainLoss: number } | null = null;
    let worstTrade: { ticker: string; gainLoss: number } | null = null;

    if (unifiedTrades.length > 0) {
      const sorted = [...unifiedTrades].sort((a, b) => b.gainLoss - a.gainLoss);
      bestTrade = { ticker: sorted[0].ticker, gainLoss: sorted[0].gainLoss };
      worstTrade = { ticker: sorted[sorted.length - 1].ticker, gainLoss: sorted[sorted.length - 1].gainLoss };
    }

    // Exit reason breakdown
    const exitReasonBreakdown = {
      stopLoss: unifiedTrades.filter(t => t.exitReason === 'STOP_HIT').length,
      manualSale: unifiedTrades.filter(t =>
        t.exitReason === 'MANUAL' || t.exitReason === 'MANUAL_SALE' ||
        t.exitReason === 'MANUAL_PROFIT' || t.exitReason === 'MANUAL_LOSS'
      ).length,
      unknown: unifiedTrades.filter(t =>
        !t.exitReason || t.exitReason === 'UNKNOWN' || t.exitReason === 'OTHER'
      ).length,
    };

    // Average holding period
    const tradesWithDays = unifiedTrades.filter(t => t.daysHeld != null && t.daysHeld >= 0);
    const avgDaysHeld = tradesWithDays.length > 0
      ? Math.round(tradesWithDays.reduce((sum, t) => sum + (t.daysHeld ?? 0), 0) / tradesWithDays.length)
      : null;

    // Total realised P&L from closed positions
    const totalRealisedPnl = unifiedTrades.reduce((sum, t) => sum + t.gainLoss, 0);

    // Open positions with unrealised gain/loss
    const openPositions = await prisma.position.findMany({
      where: { status: 'OPEN' },
      include: { stock: { select: { ticker: true } } },
    });

    const openPositionData = openPositions.map((pos) => ({
      ticker: pos.stock.ticker,
      unrealisedGainLoss: pos.exitPrice != null
        ? (pos.exitPrice - pos.entryPrice) * pos.shares
        : null,
    }));

    // Closed trade list for the page
    const tradeList = unifiedTrades.map((t) => ({
      ticker: t.ticker,
      tradeDate: t.tradeDate,
      daysHeld: t.daysHeld,
      gainLoss: t.gainLoss,
      exitReason: t.exitReason,
    }));

    return NextResponse.json({
      ok: true,
      weeksRunning,
      startingEquity,
      currentEquity,
      totalGainLoss,
      totalGainLossPct,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      bestTrade,
      worstTrade,
      totalRealisedPnl,
      exitReasonBreakdown,
      avgDaysHeld,
      openPositions: openPositionData,
      equityCurve,
      tradeList,
    });
  } catch (err) {
    console.error('GET /api/performance/summary error:', err);
    return apiError(500, 'PERFORMANCE_ERROR', 'Failed to fetch performance data');
  }
}
