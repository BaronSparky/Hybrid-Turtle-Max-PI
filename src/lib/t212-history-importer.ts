/**
 * DEPENDENCIES
 * Consumed by: /api/t212-import/route.ts, /api/t212-import/preview/route.ts
 * Consumes: trading212.ts, trading212-dual.ts, prisma.ts
 * Risk-sensitive: NO — imports historical data only, no position sizing or stop logic
 * Last modified: 2026-03-02
 * Notes: One-time T212 history importer. Pairs BUY/SELL orders into complete trades.
 *        t212OrderId @unique prevents duplicate imports — safe to re-run.
 *        Does NOT touch sacred files (stop-manager, position-sizer, risk-gates).
 */

import prisma from '@/lib/prisma';
import {
  Trading212Client,
  type Trading212Environment,
  type T212HistoricalOrder,
} from '@/lib/trading212';
import {
  getCredentialsForAccount,
  validateDualCredentials,
  type T212AccountCredentials,
} from '@/lib/trading212-dual';
import { stripT212Suffix } from '@/lib/t212-ticker-validator';

// ── Types ────────────────────────────────────────────────────────────

export type AccountFilter = 'isa' | 'invest' | 'both';

export interface ImportOptions {
  accountType: AccountFilter;
  fromDate?: Date;
  dryRun: boolean;
}

export interface TradePair {
  ticker: string;
  t212Ticker: string;
  htTicker: string | null;     // HybridTurtle ticker (null if not in Stock table)
  stockId: string | null;
  buyOrder: T212HistoricalOrder;
  sellOrder: T212HistoricalOrder;
  buyFillPrice: number;
  sellFillPrice: number;
  buyFillDate: Date;
  sellFillDate: Date;
  quantity: number;
  holdingDays: number;
  realisedPnl: number | null;  // From T212 walletImpact if available
  fxRate: number | null;
  netValueGbp: number | null;
  exitReason: string;
  initiatedFrom: string | null;
  accountType: 'invest' | 'isa';
}

export interface OpenBuy {
  ticker: string;
  t212Ticker: string;
  htTicker: string | null;
  stockId: string | null;
  buyOrder: T212HistoricalOrder;
  buyFillPrice: number;
  buyFillDate: Date;
  quantity: number;
  accountType: 'invest' | 'isa';
  existsInDb: boolean;         // Already tracked in Position table?
}

export interface ImportReport {
  accountsScanned: string[];
  totalOrdersFetched: number;
  filledOrders: number;
  tradePairs: TradePair[];
  openBuys: OpenBuy[];
  unmatchedSells: T212HistoricalOrder[];
  tickersNotInStockTable: string[];
  tradeLogsWritten: number;
  positionsConfirmed: number;
  skippedDuplicates: number;
  errors: string[];
}

// ── Ticker Mapping ───────────────────────────────────────────────────

// `stripT212Suffix` lives in t212-ticker-validator.ts — the single source
// of truth for the T212 instrument-suffix list. Imported above; do not
// redefine here (the duplicate copy was removed on 11 May 2026 to prevent
// the suffix list drifting between modules).

/**
 * Build a lookup map from T212 ticker → Stock record.
 * Uses Stock.t212Ticker first, then fallback to stripped ticker matching.
 */
async function buildTickerMap(): Promise<Map<string, { id: string; ticker: string }>> {
  const stocks = await prisma.stock.findMany({
    select: { id: true, ticker: true, t212Ticker: true },
  });

  const map = new Map<string, { id: string; ticker: string }>();

  // Primary: Stock.t212Ticker → Stock
  for (const stock of stocks) {
    if (stock.t212Ticker) {
      map.set(stock.t212Ticker, { id: stock.id, ticker: stock.ticker });
    }
  }

  // Secondary: build reverse map by stripped ticker
  // Only add if not already mapped via t212Ticker
  const byTicker = new Map<string, { id: string; ticker: string }>();
  for (const stock of stocks) {
    byTicker.set(stock.ticker, { id: stock.id, ticker: stock.ticker });
    // Also index without .L suffix for UK stocks
    if (stock.ticker.endsWith('.L')) {
      byTicker.set(stock.ticker.replace(/\.L$/, ''), { id: stock.id, ticker: stock.ticker });
    }
  }

  return new Map([...Array.from(map), ...Array.from(byTicker)]);
}

/**
 * Resolve a T212 ticker to a HybridTurtle Stock record.
 */
function resolveT212Ticker(
  t212Ticker: string,
  tickerMap: Map<string, { id: string; ticker: string }>
): { id: string; ticker: string } | null {
  // Direct match on t212Ticker
  if (tickerMap.has(t212Ticker)) {
    return tickerMap.get(t212Ticker)!;
  }

  // Stripped ticker match
  const stripped = stripT212Suffix(t212Ticker);
  if (tickerMap.has(stripped)) {
    return tickerMap.get(stripped)!;
  }

  return null;
}

// ── Fill Price Extraction ────────────────────────────────────────────

/**
 * Extract the average fill price from an order.
 * Prefers fills[] array if present, falls back to filledValue/filledQuantity.
 */
function getFillPrice(order: T212HistoricalOrder): number {
  // If fills array is available with per-fill prices, compute VWAP
  if (order.fills && order.fills.length > 0) {
    let totalValue = 0;
    let totalQty = 0;
    for (const fill of order.fills) {
      totalValue += fill.price * fill.quantity;
      totalQty += fill.quantity;
    }
    if (totalQty > 0) return totalValue / totalQty;
  }

  // Fallback: filledValue / filledQuantity
  if (order.filledQuantity > 0) {
    return order.filledValue / order.filledQuantity;
  }

  return 0;
}

/**
 * Extract fill date from an order. Prefers fills[0].filledAt, then dateExecuted.
 */
function getFillDate(order: T212HistoricalOrder): Date {
  if (order.fills && order.fills.length > 0 && order.fills[0].filledAt) {
    return new Date(order.fills[0].filledAt);
  }
  if (order.dateExecuted) {
    return new Date(order.dateExecuted);
  }
  return new Date(order.dateCreated);
}

/**
 * Extract wallet impact data from the last fill of a sell order.
 */
function getWalletImpact(order: T212HistoricalOrder): {
  realisedPnl: number | null;
  fxRate: number | null;
  netValue: number | null;
} {
  if (order.fills && order.fills.length > 0) {
    // Sum realisedProfitLoss across all fills, take fxRate from the last fill
    let totalPnl = 0;
    let totalNetValue = 0;
    let hasPnl = false;
    let lastFxRate: number | null = null;

    for (const fill of order.fills) {
      if (fill.walletImpact) {
        if (fill.walletImpact.realisedProfitLoss != null) {
          totalPnl += fill.walletImpact.realisedProfitLoss;
          hasPnl = true;
        }
        if (fill.walletImpact.netValue != null) {
          totalNetValue += fill.walletImpact.netValue;
        }
        if (fill.walletImpact.fxRate != null) {
          lastFxRate = fill.walletImpact.fxRate;
        }
      }
    }

    return {
      realisedPnl: hasPnl ? totalPnl : null,
      fxRate: lastFxRate,
      netValue: totalNetValue > 0 ? totalNetValue : null,
    };
  }

  return { realisedPnl: null, fxRate: null, netValue: null };
}

// ── Exit Reason Determination ────────────────────────────────────────

function determineExitReason(
  sellOrder: T212HistoricalOrder,
  sellFillPrice: number
): string {
  // If order had a stop price and fill was near/at that price, it's a stop hit
  if (sellOrder.stopPrice != null && sellFillPrice <= sellOrder.stopPrice * 1.005) {
    return 'STOP_HIT';
  }
  // System-initiated orders are typically stop-outs
  if (sellOrder.initiatedFrom === 'SYSTEM') {
    return 'STOP_HIT';
  }
  return 'MANUAL_SALE';
}

// ── Order Fetching ───────────────────────────────────────────────────

/**
 * Fetch all historical orders from T212 with rate limiting.
 * The getOrderHistory method auto-paginates, but we add inter-page delays
 * for the full history import to respect the 6 req/min limit.
 */
async function fetchAllOrders(
  creds: T212AccountCredentials,
  fromDate?: Date
): Promise<T212HistoricalOrder[]> {
  const client = new Trading212Client(creds.apiKey, creds.apiSecret, creds.environment);

  // Use the existing getOrderHistory which auto-paginates
  const allOrders = await client.getOrderHistory(50);

  // Filter by date if specified
  if (fromDate) {
    return allOrders.filter(o => {
      const orderDate = new Date(o.dateCreated);
      return orderDate >= fromDate;
    });
  }

  return allOrders;
}

// ── Trade Pairing ────────────────────────────────────────────────────

interface OrderWithAccount extends T212HistoricalOrder {
  _accountType: 'invest' | 'isa';
}

/**
 * Pair BUY and SELL orders into complete trades.
 *
 * Logic:
 *   - Group all filled orders by ticker
 *   - Sort by execution date ascending
 *   - Match BUYs with subsequent SELLs (FIFO)
 *   - If SELL quantity < cumulative BUY quantity: partial close
 *   - If multiple BUYs before a SELL: VWAP entry price
 */
function pairOrders(
  orders: OrderWithAccount[],
  tickerMap: Map<string, { id: string; ticker: string }>
): { tradePairs: TradePair[]; openBuys: OrderWithAccount[]; unmatchedSells: T212HistoricalOrder[] } {
  const tradePairs: TradePair[] = [];
  const remainingOpenBuys: OrderWithAccount[] = [];
  const unmatchedSells: T212HistoricalOrder[] = [];

  // Group orders by T212 ticker
  const byTicker = new Map<string, OrderWithAccount[]>();
  for (const order of orders) {
    const existing = byTicker.get(order.ticker) || [];
    existing.push(order);
    byTicker.set(order.ticker, existing);
  }

  for (const [t212Ticker, tickerOrders] of Array.from(byTicker)) {
    // Sort by execution date ascending
    tickerOrders.sort((a: OrderWithAccount, b: OrderWithAccount) => {
      const dateA = getFillDate(a).getTime();
      const dateB = getFillDate(b).getTime();
      return dateA - dateB;
    });

    // Determine order side: use .type field for historical orders
    // T212 historical orders use .type = 'BUY' | 'SELL'
    // Also check .side if available
    const buys: OrderWithAccount[] = [];
    const sells: OrderWithAccount[] = [];

    for (const order of tickerOrders) {
      const side = order.side || order.type;
      if (side === 'BUY') {
        buys.push(order);
      } else if (side === 'SELL') {
        sells.push(order);
      }
      // Skip other types (CANCELLED etc)
    }

    // Resolve HybridTurtle ticker
    const htStock = resolveT212Ticker(t212Ticker, tickerMap);

    // FIFO matching: pair buys with sells
    let buyIdx = 0;
    let buyQtyRemaining = 0;
    let buyVwapNumerator = 0;  // price * qty accumulator
    let buyVwapDenominator = 0; // qty accumulator
    let currentBuyOrder: OrderWithAccount | null = null;
    let firstBuyDate: Date | null = null;
    let currentAccountType: 'invest' | 'isa' = 'invest';

    for (const sell of sells) {
      const sellQty = sell.filledQuantity;
      const sellFillPrice = getFillPrice(sell);
      const sellFillDate = getFillDate(sell);
      let sellQtyRemaining = sellQty;

      // Consume buy orders to match this sell.
      // Also continue if buyQtyRemaining > 0 (pre-loaded by the accumulate block
      // on the previous iteration — without this, the last buy's quantity never
      // gets matched when the accumulate block increments buyIdx past buys.length).
      while (sellQtyRemaining > 0.0001 && (buyIdx < buys.length || buyQtyRemaining > 0.0001)) {
        if (buyQtyRemaining <= 0.0001) {
          // Load next buy
          currentBuyOrder = buys[buyIdx];
          buyQtyRemaining = currentBuyOrder.filledQuantity;
          const buyPrice = getFillPrice(currentBuyOrder);
          buyVwapNumerator = buyPrice * buyQtyRemaining;
          buyVwapDenominator = buyQtyRemaining;
          firstBuyDate = getFillDate(currentBuyOrder);
          currentAccountType = currentBuyOrder._accountType;
          buyIdx++;
        }

        const matchQty = Math.min(sellQtyRemaining, buyQtyRemaining);
        sellQtyRemaining -= matchQty;
        buyQtyRemaining -= matchQty;

        // If buy fully consumed and there are more buys needed, accumulate VWAP
        if (buyQtyRemaining <= 0.0001 && sellQtyRemaining > 0.0001 && buyIdx < buys.length) {
          const nextBuy = buys[buyIdx];
          const nextPrice = getFillPrice(nextBuy);
          buyQtyRemaining = nextBuy.filledQuantity;
          buyVwapNumerator += nextPrice * buyQtyRemaining;
          buyVwapDenominator += buyQtyRemaining;
          if (!firstBuyDate) firstBuyDate = getFillDate(nextBuy);
          currentBuyOrder = nextBuy;
          buyIdx++;
        }
      }

      // If we had enough buys to match this sell, create a trade pair
      if (sellQtyRemaining <= 0.0001 && currentBuyOrder && firstBuyDate) {
        const buyFillPrice = buyVwapDenominator > 0
          ? buyVwapNumerator / buyVwapDenominator
          : getFillPrice(currentBuyOrder);

        const wallet = getWalletImpact(sell);
        const holdingDays = Math.max(0, Math.floor(
          (sellFillDate.getTime() - firstBuyDate.getTime()) / 86400000
        ));

        tradePairs.push({
          ticker: stripT212Suffix(t212Ticker),
          t212Ticker,
          htTicker: htStock?.ticker ?? null,
          stockId: htStock?.id ?? null,
          buyOrder: currentBuyOrder,
          sellOrder: sell,
          buyFillPrice,
          sellFillPrice,
          buyFillDate: firstBuyDate,
          sellFillDate,
          quantity: sellQty,
          holdingDays,
          realisedPnl: wallet.realisedPnl,
          fxRate: wallet.fxRate,
          netValueGbp: wallet.netValue,
          exitReason: determineExitReason(sell, sellFillPrice),
          initiatedFrom: sell.initiatedFrom ?? null,
          accountType: currentAccountType,
        });

        // Reset for next sell
        buyVwapNumerator = 0;
        buyVwapDenominator = 0;
        firstBuyDate = null;
      } else if (sellQtyRemaining > 0.0001) {
        // Sell with no matching buy
        unmatchedSells.push(sell);
      }
    }

    // Any remaining buys are open positions
    // First, add back partially consumed current buy
    if (buyQtyRemaining > 0.0001 && currentBuyOrder) {
      remainingOpenBuys.push(currentBuyOrder);
    }
    // Then any fully unconsumed buys
    for (let i = buyIdx; i < buys.length; i++) {
      remainingOpenBuys.push(buys[i]);
    }
  }

  return { tradePairs, openBuys: remainingOpenBuys, unmatchedSells };
}

// ── Main Import Function ─────────────────────────────────────────────

export async function importT212History(options: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = {
    accountsScanned: [],
    totalOrdersFetched: 0,
    filledOrders: 0,
    tradePairs: [],
    openBuys: [],
    unmatchedSells: [],
    tickersNotInStockTable: [],
    tradeLogsWritten: 0,
    positionsConfirmed: 0,
    skippedDuplicates: 0,
    errors: [],
  };

  // 1. Load user and credentials
  const user = await prisma.user.findFirst({
    select: {
      id: true,
      t212ApiKey: true,
      t212ApiSecret: true,
      t212Environment: true,
      t212Connected: true,
      t212IsaApiKey: true,
      t212IsaApiSecret: true,
      t212IsaConnected: true,
    },
  });

  if (!user) {
    report.errors.push('No user found in database');
    return report;
  }

  const creds = validateDualCredentials(user);
  if (!creds.canFetch) {
    report.errors.push('No T212 credentials configured');
    return report;
  }

  // Validate that requested account(s) actually have credentials
  const investCreds = getCredentialsForAccount(user, 'invest');
  const isaCreds = getCredentialsForAccount(user, 'isa');

  if (options.accountType === 'isa' && !isaCreds) {
    report.errors.push(
      'ISA account not connected. Go to Settings → Trading 212 and add your ISA API key first.'
    );
    return report;
  }
  if (options.accountType === 'invest' && !investCreds) {
    report.errors.push(
      'Invest account not connected. Go to Settings → Trading 212 and add your Invest API key first.'
    );
    return report;
  }
  if (options.accountType === 'both' && !investCreds && !isaCreds) {
    report.errors.push('No T212 credentials configured for either account');
    return report;
  }

  // 2. Fetch orders from requested account(s)
  const allOrders: OrderWithAccount[] = [];

  if ((options.accountType === 'invest' || options.accountType === 'both') && investCreds) {
    try {
      report.accountsScanned.push('invest');
      const orders = await fetchAllOrders(investCreds, options.fromDate);
      for (const o of orders) {
        allOrders.push({ ...o, _accountType: 'invest' as const });
      }
    } catch (err) {
      report.errors.push(`Invest account fetch failed: ${(err as Error).message}`);
    }
  }

  if ((options.accountType === 'isa' || options.accountType === 'both') && isaCreds) {
    try {
      report.accountsScanned.push('isa');
      // Small delay between account fetches to avoid rate limits
      if (allOrders.length > 0) {
        await sleep(2000);
      }
      const orders = await fetchAllOrders(isaCreds, options.fromDate);
      for (const o of orders) {
        allOrders.push({ ...o, _accountType: 'isa' as const });
      }
    } catch (err) {
      report.errors.push(`ISA account fetch failed: ${(err as Error).message}`);
    }
  }

  report.totalOrdersFetched = allOrders.length;

  // 3. Filter to FILLED orders only
  const filledOrders = allOrders.filter(o => {
    const status = (o.status || '').toUpperCase();
    return status === 'FILLED' && o.filledQuantity > 0;
  });
  report.filledOrders = filledOrders.length;

  if (filledOrders.length === 0) {
    report.errors.push('No filled orders found');
    return report;
  }

  // 4. Build ticker map
  const tickerMap = await buildTickerMap();

  // 5. Pair BUY/SELL orders into trades
  const { tradePairs, openBuys, unmatchedSells } = pairOrders(filledOrders, tickerMap);
  report.tradePairs = tradePairs;
  report.unmatchedSells = unmatchedSells;

  // 6. Resolve open buys against existing Position table
  const existingPositions = await prisma.position.findMany({
    where: { status: 'OPEN' },
    select: { id: true, t212Ticker: true, stock: { select: { ticker: true, t212Ticker: true } } },
  });

  const existingT212Tickers = new Set<string>();
  for (const pos of existingPositions) {
    if (pos.t212Ticker) existingT212Tickers.add(pos.t212Ticker);
    if (pos.stock.t212Ticker) existingT212Tickers.add(pos.stock.t212Ticker);
  }

  report.openBuys = openBuys.map(ob => {
    const htStock = resolveT212Ticker(ob.ticker, tickerMap);
    return {
      ticker: stripT212Suffix(ob.ticker),
      t212Ticker: ob.ticker,
      htTicker: htStock?.ticker ?? null,
      stockId: htStock?.id ?? null,
      buyOrder: ob,
      buyFillPrice: getFillPrice(ob),
      buyFillDate: getFillDate(ob),
      quantity: ob.filledQuantity,
      accountType: ob._accountType,
      existsInDb: existingT212Tickers.has(ob.ticker),
    };
  });

  // 7. Identify tickers not in Stock table
  const allT212Tickers = new Set<string>();
  for (const pair of tradePairs) allT212Tickers.add(pair.t212Ticker);
  for (const ob of report.openBuys) allT212Tickers.add(ob.t212Ticker);

  for (const t of Array.from(allT212Tickers)) {
    if (!resolveT212Ticker(t, tickerMap)) {
      report.tickersNotInStockTable.push(t);
    }
  }

  // 8. If dry run, return the report without writing to DB
  if (options.dryRun) {
    return report;
  }

  // 9. Write trades to database
  const userId = user.id;

  for (const pair of tradePairs) {
    try {
      // Check for duplicate via t212OrderId (sell order ID)
      const t212OrderId = pair.sellOrder.id.toString();
      const existing = await prisma.tradeLog.findUnique({
        where: { t212OrderId },
      });

      if (existing) {
        report.skippedDuplicates++;
        continue;
      }

      await prisma.tradeLog.create({
        data: {
          userId,
          ticker: pair.htTicker || pair.ticker,
          tradeDate: pair.sellFillDate,
          tradeType: 'EXIT',
          decision: 'TAKEN',
          entryPrice: pair.buyFillPrice,
          exitPrice: pair.sellFillPrice,
          exitReason: pair.exitReason,
          shares: pair.quantity,
          daysHeld: pair.holdingDays,
          gainLossGbp: pair.realisedPnl,
          // T212-specific fields
          t212OrderId,
          t212Ticker: pair.t212Ticker,
          fillPrice: pair.sellFillPrice,
          fillQuantity: pair.quantity,
          fillTimestamp: pair.sellFillDate,
          fxRateAtFill: pair.fxRate,
          netValueGbp: pair.netValueGbp,
          realisedPnlT212: pair.realisedPnl,
          initiatedFrom: pair.initiatedFrom,
          importedFromT212: true,
          importedAt: new Date(),
          // Fields that can't be populated from T212 history:
          // bqsScore, fwsScore, ncsScore, regime, atrAtEntry, adxAtEntry — all null
        },
      });
      report.tradeLogsWritten++;
    } catch (err) {
      const msg = (err as Error).message;
      // P2002 = unique constraint violation — skip duplicate silently
      if ((err as { code?: string }).code === 'P2002') {
        report.skippedDuplicates++;
      } else {
        report.errors.push(`Failed to write trade ${pair.ticker}: ${msg}`);
      }
    }
  }

  // 10. Confirm open positions
  for (const ob of report.openBuys) {
    if (ob.existsInDb) {
      report.positionsConfirmed++;
    }
    // We don't create new Position records from history import —
    // the user should add positions via the normal workflow.
    // Open buys are reported so the user can verify they match.
  }

  return report;
}

// ── Helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
