/**
 * DEPENDENCIES
 * Consumed by: /api/trading212/sync
 * Consumes: trading212.ts, trading212-dual.ts, default-user.ts, equity-snapshot.ts, risk-gates.ts, market-data.ts, prisma.ts, @/types
 * Risk-sensitive: YES
 * Last modified: 2026-02-23
 * Notes: Dual-account broker sync — fetches Invest + ISA in parallel via DualT212Client.
 *        Positions are kept SEPARATE with accountType tagging. Never aggregates.
 */
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { mapT212Position, mapT212AccountSummary, type T212PendingOrder } from '@/lib/trading212';
import {
  DualT212Client,
  validateDualCredentials,
  getCredentialsForAccount,
  type T212AccountType,
  type T212AccountData,
} from '@/lib/trading212-dual';
import { ensureDefaultUser } from '@/lib/default-user';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { validateRiskGates } from '@/lib/risk-gates';
import { getFXRate } from '@/lib/market-data';
import { apiError } from '@/lib/api-response';
import {
  buildSyncIndex,
  findExistingForSync,
  isExistingStillActive,
  shouldSkipForCrossAccountDuplicate,
} from '@/lib/trading212-sync-merge';
import {
  getCanonicalStockTickerCandidates,
  looksLikeValidT212Ticker,
} from '@/lib/t212-ticker-validator';
import { calcSyncedPositionRisk } from '@/lib/synced-position-risk';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import type { RiskProfileType, Sleeve } from '@/types';

const syncRequestSchema = z.object({
  userId: z.string().trim().min(1).optional(),
});

// POST /api/trading212/sync — Sync positions from Trading 212 (both Invest + ISA)
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, syncRequestSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    let userId: string = parsed.data.userId ?? '';

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    // Load user with both Invest + ISA credentials
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        t212ApiKey: true,
        t212ApiSecret: true,
        t212Environment: true,
        t212Connected: true,
        t212IsaApiKey: true,
        t212IsaApiSecret: true,
        t212IsaConnected: true,
        riskProfile: true,
      },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const credStatus = validateDualCredentials(user);
    if (!credStatus.canFetch) {
      return apiError(400, 'T212_NOT_CONFIGURED', 'No Trading 212 accounts connected. Go to Settings to add credentials.');
    }

    // Build dual client from DB credentials
    const investCreds = getCredentialsForAccount(user, 'invest');
    const isaCreds = getCredentialsForAccount(user, 'isa');
    const dualClient = new DualT212Client(investCreds, isaCreds);

    // Fetch both accounts in parallel (Promise.allSettled under the hood)
    const dualResult = await dualClient.fetchBothAccounts();

    // Lazily fetch this user's live T212 stop orders the first time a NEW
    // position needs creating. This lets a synced manual buy record the user's
    // REAL broker stop instead of the 5%-of-entry placeholder. Memoized so we
    // pay at most one getPendingOrders call per account per sync, and only when
    // there is actually a position to create (the common update-only sync makes
    // zero extra API calls). Best-effort inside fetchPendingStopOrders — a
    // failure yields empty arrays and we transparently fall back to the default.
    let pendingStopsCache: { invest: T212PendingOrder[]; isa: T212PendingOrder[] } | null = null;
    const getPendingStops = async () => {
      if (!pendingStopsCache) {
        pendingStopsCache = await dualClient.fetchPendingStopOrders();
      }
      return pendingStopsCache;
    };

    // Per-account sync results
    const syncResults = {
      invest: { created: 0, updated: 0, closed: 0, errors: [] as string[] },
      isa: { created: 0, updated: 0, closed: 0, errors: [] as string[] },
      riskGateWarnings: [] as string[],
    };

    // Capture fetch-level errors
    if (dualResult.errors.invest) {
      syncResults.invest.errors.push(`Fetch failed: ${dualResult.errors.invest}`);
    }
    if (dualResult.errors.isa) {
      syncResults.isa.errors.push(`Fetch failed: ${dualResult.errors.isa}`);
    }

    // Detect same-key duplication: if Invest and ISA use the same API key,
    // skip ISA sync entirely to avoid double-counting positions
    const isDuplicateKey = !!(investCreds && isaCreds && investCreds.apiKey === isaCreds.apiKey);
    if (isDuplicateKey) {
      syncResults.isa.errors.push('Skipped — same API key as Invest account (duplicate)');
    }

    // Sync each account's positions to the database
    const accountTypes: T212AccountType[] = isDuplicateKey ? ['invest'] : ['invest', 'isa'];
    for (const acctType of accountTypes) {
      const acctData: T212AccountData | null = dualResult[acctType];
      if (!acctData) continue; // No data — either not connected or fetch failed

      const mappedPositions = acctData.positions.map((p) => mapT212Position(p, acctType));
      const acctResults = syncResults[acctType];

      // Get existing OPEN positions for this account type across ALL sources.
      // We must include source='auto-trade' (and 'manual') here — otherwise the
      // sync re-creates a fresh trading212 row over the top of a position the
      // auto-trader already recorded, producing duplicates in the OPEN list.
      const existingPositions = await prisma.position.findMany({
        where: { userId, status: 'OPEN', accountType: acctType },
        include: { stock: true },
      });

      // Index existing rows by both keys we may receive from T212:
      //   - full T212 ticker (e.g. UNFI_US_EQ) when t212Ticker is populated
      //   - bare stock ticker (e.g. UNFI) for legacy rows where t212Ticker is null
      // Lookups below try fullTicker first, then bare ticker.
      const existingIndex = buildSyncIndex(existingPositions);

      // If any incoming holding isn't tracked yet, fetch this account's live
      // T212 stop orders so the new Position records the real broker stop
      // instead of a 5%-of-entry placeholder. Over-triggering (fetching when it
      // turns out to be an update via canonical reconciliation) is harmless; we
      // never under-fetch a genuine new buy. An empty map => 5% default.
      const hasNewPositions = mappedPositions.some(
        (pos) => !findExistingForSync(existingIndex, pos)
      );
      const knownStopByFullTicker = new Map<string, number>();
      if (hasNewPositions) {
        const pending = await getPendingStops();
        for (const order of pending[acctType]) {
          if (typeof order.stopPrice === 'number' && order.stopPrice > 0) {
            knownStopByFullTicker.set(order.ticker, order.stopPrice);
          }
        }
      }

      // Cross-account duplicate guard: find t212Tickers already open under OTHER account types.
      // Prevents creating the same position twice when both Invest and ISA see the same holdings.
      // Same as above: must consider all sources, not just trading212-sourced rows.
      const otherAccountType = acctType === 'invest' ? 'isa' : 'invest';
      const crossAccountPositions = await prisma.position.findMany({
        where: { userId, status: 'OPEN', accountType: otherAccountType },
        select: { t212Ticker: true },
      });
      const crossAccountTickers = new Set(
        crossAccountPositions.map((p) => p.t212Ticker).filter((t): t is string => Boolean(t))
      );

      // Track which T212 tickers are still open in this account
      const activeT212Tickers = new Set<string>();
      const activeBareTickers = new Set<string>();

      for (const pos of mappedPositions) {
        activeT212Tickers.add(pos.fullTicker);
        activeBareTickers.add(pos.ticker);

        // Skip if this ticker already exists as an OPEN position under the other account type
        // (prevents duplicates when Invest and ISA see the same holdings)
        if (shouldSkipForCrossAccountDuplicate(existingIndex, crossAccountTickers, pos)) {
          acctResults.errors.push(`Skipped ${pos.ticker} — already tracked under ${otherAccountType} account`);
          continue;
        }

        try {
          // Atomic: ensure stock exists + create/update position in one transaction
          await prisma.$transaction(async (tx) => {
            // Probe canonical-Yahoo equivalents before stub-creating a new Stock
            // row. This collapses listing-variant duplicates such as RBOTl ↔ RBOT
            // (lowercase-l = LSE listing of the same iShares ETF) onto a single
            // canonical Stock row, instead of stamping out a bare-ticker stub
            // that the auto-trader's t212Ticker would later 404 against.
            //
            // Behaviour for non-listing-variant tickers (the vast majority) is
            // unchanged: getCanonicalStockTickerCandidates returns just
            // [pos.ticker], and findFirst over a one-element list is equivalent
            // to findUnique.
            const candidates = getCanonicalStockTickerCandidates(pos.ticker);
            const matches = await tx.stock.findMany({
              where: { ticker: { in: candidates } },
            });
            // Prefer an exact match on pos.ticker (preserves prior behaviour);
            // otherwise fall back to the first canonical alternative.
            let stock = matches.find((s) => s.ticker === pos.ticker) ?? matches[0] ?? null;

            if (!stock) {
              stock = await tx.stock.create({
                data: {
                  ticker: pos.ticker,
                  name: pos.name,
                  sleeve: 'CORE', // Default — user can reclassify
                },
              });
            } else if (
              stock.ticker !== pos.ticker &&
              !looksLikeValidT212Ticker(stock.t212Ticker)
            ) {
              // Reconciled onto a canonical-Yahoo equivalent row (e.g. broker
              // reported RBOTl, matched canonical RBOT). Backfill the canonical
              // row's t212Ticker from the broker's full ticker so future
              // auto-trades on the canonical scanner ticker resolve to a valid
              // T212 instrument identifier instead of 404ing.
              stock = await tx.stock.update({
                where: { id: stock.id },
                data: { t212Ticker: pos.fullTicker },
              });
              acctResults.errors.push(
                `Reconciled ${pos.ticker} → canonical Stock '${stock.ticker}' and backfilled t212Ticker=${pos.fullTicker}`,
              );
            }

            // Match by full T212 ticker first (the strong key); fall back to
            // bare stock ticker so legacy rows with t212Ticker=null (e.g. older
            // auto-trade or manual entries) merge instead of duplicate.
            //
            // When we reconciled `pos` onto a canonical Stock row whose ticker
            // differs from `pos.ticker` (e.g. RBOTl → RBOT), also probe for an
            // existing position attached to that canonical Stock. Without this
            // probe a pre-existing manual/auto-trade position on the canonical
            // row would be missed and we'd create a duplicate.
            let existing = findExistingForSync(existingIndex, pos);
            if (!existing && stock.ticker !== pos.ticker) {
              existing = existingIndex.byBareTicker.get(stock.ticker) ?? null;
            }

            if (existing) {
              // Update existing position — ONLY update shares count and
              // backfill t212Ticker if it was missing. Never overwrite
              // entryPrice/initialRisk: those are tied to our original
              // entry decision and underpin every R-multiple calculation.
              await tx.position.update({
                where: { id: existing.id },
                data: {
                  shares: pos.shares,
                  t212Ticker: existing.t212Ticker ?? pos.fullTicker,
                  updatedAt: new Date(),
                },
              });
              acctResults.updated++;
            } else {
              // Create new position.
              // Record the user's REAL T212 stop when one exists for this ticker
              // (manual buys with a custom stop, e.g. RBOTl 8 May 2026 had
              // $19.81 set in T212 but was synced with the 5% default before
              // this path existed). calcSyncedPositionRisk validates the stop is
              // 0 < stop < entry; anything else (missing, stale-above-entry)
              // falls back to the legacy 5%-of-entry default.
              const knownStop = knownStopByFullTicker.get(pos.fullTicker);
              const risk = calcSyncedPositionRisk(pos.entryPrice, knownStop);
              const initialRisk = risk.initialRisk;
              const stopLoss = risk.stopLoss;
              const stopNote = risk.source === 'KNOWN_STOP'
                ? `stop ${stopLoss.toFixed(2)} from T212 order`
                : 'stop defaulted to 5% (no T212 stop found)';

              await tx.position.create({
                data: {
                  userId,
                  stockId: stock.id,
                  status: 'OPEN',
                  source: 'trading212',
                  accountType: acctType,
                  t212Ticker: pos.fullTicker,
                  entryPrice: pos.entryPrice,
                  entryDate: new Date(pos.entryDate),
                  shares: pos.shares,
                  stopLoss,
                  initialRisk,
                  currentStop: stopLoss,
                  entry_price: pos.entryPrice,
                  initial_stop: stopLoss,
                  initial_R: initialRisk,
                  atr_at_entry: null,
                  profile_used: user.riskProfile,
                  entry_type: 'BREAKOUT',
                  protectionLevel: 'INITIAL',
                  notes: `Synced from Trading 212 (${acctType.toUpperCase()}). ISIN: ${pos.isin}. ${stopNote}`,
                },
              });
              acctResults.created++;
            }
          });
        } catch (err) {
          acctResults.errors.push(`Error syncing ${pos.ticker}: ${(err as Error).message}`);
        }
      }

      // Mark positions as closed if they no longer exist on Trading 212 for this account.
      // CRITICAL GUARD: Only auto-close if positions were actually fetched from T212.
      // If the positions endpoint failed (rate-limited, timeout, etc.) but summary
      // succeeded, acctData.positions is [] but positionsFetched is false.
      // Closing positions based on a degraded empty list would be a data-loss bug.
      if (acctData.positionsFetched) {
        for (const existing of existingPositions) {
          // A position is still active if T212 returned it under either key
          // we know about. We compare both because legacy rows may carry
          // only the bare ticker (t212Ticker is null).
          if (isExistingStillActive(existing, activeT212Tickers, activeBareTickers)) continue;

          try {
            await prisma.position.update({
              where: { id: existing.id },
              data: {
                status: 'CLOSED',
                exitDate: new Date(),
                exitReason: `Closed on Trading 212 (${acctType.toUpperCase()})`,
              },
            });
            acctResults.closed++;
          } catch (err) {
            acctResults.errors.push(`Error closing ${existing.t212Ticker ?? existing.stock.ticker}: ${(err as Error).message}`);
          }
        }
      } else if (existingPositions.length > 0) {
        // Positions fetch failed — log warning but don't close anything
        acctResults.errors.push(`Positions fetch degraded for ${acctType.toUpperCase()} — skipped auto-close of ${existingPositions.length} existing position(s)`);
      }
    }

    // Calculate combined total value for risk gate checks + equity.
    // If invest and ISA use the same API key, don't double-count.
    const investTotal = dualResult.invest?.summary?.totalValue ?? 0;
    const isaTotal = isDuplicateKey ? 0 : (dualResult.isa?.summary?.totalValue ?? 0);
    const combinedTotalValue = investTotal + isaTotal;

    // Risk gate validation across ALL positions (both accounts)
    // Build live price map from T212 position data for accurate value/risk calculations
    const t212LivePrices = new Map<string, number>();
    for (const acctType of accountTypes) {
      const acctData = dualResult[acctType];
      if (!acctData) continue;
      for (const rawPos of acctData.positions) {
        const mapped = mapT212Position(rawPos, acctType);
        if (mapped.currentPrice > 0) {
          t212LivePrices.set(mapped.ticker, mapped.currentPrice);
        }
      }
    }

    const fxCache = new Map<string, number>();
    const getFxToGbp = async (currency: string | null, ticker: string): Promise<number> => {
      const curr = (currency || 'USD').toUpperCase();
      if (curr === 'GBX' || curr === 'GBp') return 0.01;
      if (curr === 'GBP') return 1;
      const isUk = ticker.endsWith('.L') || /^[A-Z]{2,5}l$/.test(ticker);
      if (isUk && (!currency || currency === '')) return 0.01;
      const cached = fxCache.get(curr);
      if (cached != null) return cached;
      const rate = await getFXRate(curr, 'GBP');
      fxCache.set(curr, rate);
      return rate;
    };

    try {
      const openPositions = await prisma.position.findMany({
        where: { userId, status: 'OPEN' },
        include: { stock: true },
      });

      const positionsForGates = await Promise.all(openPositions.map(async (p) => {
        const fxToGbp = await getFxToGbp(p.stock.currency, p.stock.ticker);
        // Use live price from T212 if available, fallback to entry price
        const rawCurrentPrice = t212LivePrices.get(p.stock.ticker) ?? p.entryPrice;
        const currentPriceGbp = rawCurrentPrice * fxToGbp;
        const currentStopGbp = p.currentStop * fxToGbp;
        return {
          id: p.id,
          ticker: p.stock.ticker,
          sleeve: (p.stock.sleeve || 'CORE') as Sleeve,
          sector: p.stock.sector || 'Unknown',
          cluster: p.stock.cluster || 'General',
          value: currentPriceGbp * p.shares,
          riskDollars: Math.max(0, (currentPriceGbp - currentStopGbp) * p.shares),
          shares: p.shares,
          entryPrice: p.entryPrice * fxToGbp,
          currentStop: currentStopGbp,
          currentPrice: currentPriceGbp,
        };
      }));

      for (const pos of positionsForGates) {
        const existing = positionsForGates.filter((p) => p.id !== pos.id);
        const gateResults = validateRiskGates(
          {
            sleeve: pos.sleeve,
            sector: pos.sector,
            cluster: pos.cluster,
            value: pos.value,
            riskDollars: pos.riskDollars,
          },
          existing,
          combinedTotalValue,
          user.riskProfile as RiskProfileType
        );
        const failed = gateResults.filter((g) => !g.passed);
        if (failed.length > 0) {
          syncResults.riskGateWarnings.push(
            `${pos.ticker}: ${failed.map((g) => g.gate).join(', ')}`
          );
        }
      }
    } catch (error) {
      syncResults.riskGateWarnings.push(`Risk gate warning check failed: ${(error as Error).message}`);
    }

    // Update user's cached account data for each connected account.
    // If duplicate key detected, clear ISA fields to prevent future double-counting.
    const userUpdate: Record<string, unknown> = {};

    if (dualResult.invest?.summary) {
      const s = dualResult.invest.summary;
      Object.assign(userUpdate, {
        t212Connected: true,
        t212LastSync: new Date(),
        t212AccountId: s.accountId.toString(),
        t212Currency: s.currency,
        t212Cash: s.cash,
        t212Invested: s.investmentsCost, // Cost basis, not current value
        t212UnrealisedPL: s.unrealizedPL,
        t212TotalValue: s.totalValue,
      });
    }

    if (isDuplicateKey) {
      // Same API key stored in both Invest and ISA — clear ISA cached values
      // to prevent the GET endpoint from double-counting
      Object.assign(userUpdate, {
        t212IsaTotalValue: null,
        t212IsaCash: null,
        t212IsaInvested: null,
        t212IsaUnrealisedPL: null,
      });
    } else if (dualResult.isa?.summary) {
      const s = dualResult.isa.summary;
      Object.assign(userUpdate, {
        t212IsaLastSync: new Date(),
        t212IsaAccountId: s.accountId.toString(),
        t212IsaCurrency: s.currency,
        t212IsaCash: s.cash,
        t212IsaInvested: s.investmentsCost, // Cost basis, not current value
        t212IsaUnrealisedPL: s.unrealizedPL,
        t212IsaTotalValue: s.totalValue,
      });
    }

    // Equity is the combined total across both accounts
    if (combinedTotalValue > 0) {
      userUpdate.equity = combinedTotalValue;
    }

    if (Object.keys(userUpdate).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: userUpdate,
      });
    }

    if (combinedTotalValue > 0) {
      // BROKER-sourced: this is the authoritative writer of equity. Tagged
      // so the user-facing curve can filter to broker-only rows.
      await recordEquitySnapshot(userId, combinedTotalValue, undefined, 'BROKER');
    }

    // Build combined position list for response
    const allMappedPositions = dualClient.getCombinedPositions(dualResult);

    // Build backward-compatible flat account fields from whichever accounts are connected.
    // If duplicate key, only use invest summary to avoid double-counting.
    const investSummary = dualResult.invest?.summary;
    const isaSummary = isDuplicateKey ? null : dualResult.isa?.summary;
    const flatAccount = {
      accountId: investSummary?.accountId ?? isaSummary?.accountId ?? 0,
      currency: investSummary?.currency ?? isaSummary?.currency ?? 'GBP',
      cash: (investSummary?.cash ?? 0) + (isaSummary?.cash ?? 0),
      totalCash: (investSummary?.totalCash ?? 0) + (isaSummary?.totalCash ?? 0),
      investmentsValue: (investSummary?.investmentsValue ?? 0) + (isaSummary?.investmentsValue ?? 0),
      investmentsCost: (investSummary?.investmentsCost ?? 0) + (isaSummary?.investmentsCost ?? 0),
      unrealizedPL: (investSummary?.unrealizedPL ?? 0) + (isaSummary?.unrealizedPL ?? 0),
      realizedPL: (investSummary?.realizedPL ?? 0) + (isaSummary?.realizedPL ?? 0),
      totalValue: combinedTotalValue,
    };

    return NextResponse.json({
      success: true,
      sync: syncResults,
      account: flatAccount,
      // Dual-account detail for consumers that want per-account data
      accounts: {
        invest: investSummary ?? null,
        isa: isaSummary ?? null,
        combinedTotalValue,
      },
      positions: allMappedPositions,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Trading 212 sync error:', error);
    return apiError(500, 'T212_SYNC_FAILED', (error as Error).message || 'Failed to sync with Trading 212', undefined, true);
  }
}

// GET /api/trading212/sync — Get sync status (both Invest + ISA)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        t212ApiKey: true,
        t212IsaApiKey: true,
        t212Connected: true,
        t212LastSync: true,
        t212AccountId: true,
        t212Currency: true,
        t212Environment: true,
        t212Cash: true,
        t212Invested: true,
        t212UnrealisedPL: true,
        t212TotalValue: true,
        // ISA fields
        t212IsaConnected: true,
        t212IsaLastSync: true,
        t212IsaAccountId: true,
        t212IsaCurrency: true,
        t212IsaCash: true,
        t212IsaInvested: true,
        t212IsaUnrealisedPL: true,
        t212IsaTotalValue: true,
      },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Detect if Invest and ISA use the same API key (user entered same key twice)
    const isDuplicateKey = !!(user.t212ApiKey && user.t212IsaApiKey && user.t212ApiKey === user.t212IsaApiKey);

    // Count positions per account type.
    // Do NOT filter by source: auto-trade rows are real T212 holdings carrying
    // the same accountType. Filtering by source='trading212' here was the same
    // bug class that hid 3 of 6 positions on the portfolio screen.
    const [investPositionCount, isaPositionCount] = await Promise.all([
      prisma.position.count({
        where: { userId, status: 'OPEN', accountType: 'invest' },
      }),
      prisma.position.count({
        where: { userId, status: 'OPEN', accountType: 'isa' },
      }),
    ]);

    // Derive top-level fields from whichever account is connected (prefer invest, fallback to ISA)
    const primaryAccountId = user.t212AccountId ?? user.t212IsaAccountId;
    const primaryCurrency = user.t212Currency ?? user.t212IsaCurrency;
    const primaryLastSync = user.t212LastSync ?? user.t212IsaLastSync;

    // If same API key in both, zero out ISA values to prevent double-counting
    const isaTotalValue = isDuplicateKey ? 0 : (user.t212IsaTotalValue ?? 0);
    const isaCash = isDuplicateKey ? 0 : (user.t212IsaCash ?? 0);
    const isaInvested = isDuplicateKey ? 0 : (user.t212IsaInvested ?? 0);
    const isaUnrealisedPL = isDuplicateKey ? 0 : (user.t212IsaUnrealisedPL ?? 0);

    // Effective ISA position count: zero when invest+ISA share an API key,
    // since the duplicate-key guard suppresses ISA writes and the ISA tile
    // is already force-zeroed below. Keeping the top-level total in lockstep
    // prevents the dashboard reading "6 positions" while the ISA card shows 0.
    const effectiveIsaPositionCount = isDuplicateKey ? 0 : isaPositionCount;

    return NextResponse.json({
      // Backward-compatible top-level fields
      connected: user.t212Connected || user.t212IsaConnected,
      lastSync: primaryLastSync,
      accountId: primaryAccountId,
      currency: primaryCurrency,
      environment: user.t212Environment,
      positionCount: investPositionCount + effectiveIsaPositionCount,
      account: {
        totalValue: (user.t212TotalValue ?? 0) + isaTotalValue,
        cash: (user.t212Cash ?? 0) + isaCash,
        invested: (user.t212Invested ?? 0) + isaInvested,
        unrealisedPL: (user.t212UnrealisedPL ?? 0) + isaUnrealisedPL,
      },
      ...(isDuplicateKey ? { duplicateKeyWarning: 'Invest and ISA use the same API key — ISA values excluded to prevent double-counting' } : {}),
      // New dual-account detail
      invest: {
        connected: user.t212Connected,
        lastSync: user.t212LastSync,
        accountId: user.t212AccountId,
        currency: user.t212Currency,
        positionCount: investPositionCount,
        totalValue: user.t212TotalValue,
        cash: user.t212Cash,
        invested: user.t212Invested,
      },
      isa: {
        connected: isDuplicateKey ? false : user.t212IsaConnected,
        lastSync: user.t212IsaLastSync,
        accountId: user.t212IsaAccountId,
        currency: user.t212IsaCurrency,
        positionCount: isDuplicateKey ? 0 : isaPositionCount,
        totalValue: isDuplicateKey ? null : user.t212IsaTotalValue,
        cash: isDuplicateKey ? null : user.t212IsaCash,
        invested: isDuplicateKey ? null : user.t212IsaInvested,
      },
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return apiError(500, 'T212_SYNC_STATUS_FAILED', 'Failed to get sync status', (error as Error).message, true);
  }
}
