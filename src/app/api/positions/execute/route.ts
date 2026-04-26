/**
 * DEPENDENCIES
 * Consumed by: BuyConfirmationModal.tsx (frontend)
 * Consumes: trading212.ts, trading212-dual.ts, positions/route.ts (POST), prisma (ExecutionLog)
 * Risk-sensitive: YES — places real orders on Trading 212
 * Last modified: 2026-02-28
 * Notes: 4-phase execution: buy → poll → stop → DB position.
 *        Every T212 API call is logged to ExecutionLog for audit trail.
 *        Uses SSE (Server-Sent Events) to stream progress to the modal.
 */

export const dynamic = 'force-dynamic';

import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { Trading212Client, Trading212Error, type T212PendingOrder } from '@/lib/trading212';
import type { T212AccountType } from '@/lib/trading212-dual';
import { ensureDefaultUser } from '@/lib/default-user';
import { z } from 'zod';
import { assertSubmissionAllowed, SafetyControlError } from '../../../../../packages/workflow/src';
import { runPreExecutionDryRun } from '@/lib/pre-execution-dry-run';
import { getMarketRegime } from '@/lib/market-data';

// ── Types ────────────────────────────────────────────────────

interface ExecutionPhase {
  phase: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
  orderId?: number;
  filledQuantity?: number;
  filledPrice?: number;
}

// ── Zod Schema ───────────────────────────────────────────────

const executeSchema = z.object({
  userId: z.string().trim().min(1),
  stockId: z.string().trim().min(1),
  ticker: z.string().trim().min(1),           // Yahoo format
  t212Ticker: z.string().trim().min(1),       // T212 format: AAPL_US_EQ
  quantity: z.coerce.number().positive(),      // Shares to buy (positive)
  stopPrice: z.coerce.number().positive(),     // Pre-computed stop-loss price
  entryPrice: z.coerce.number().positive(),    // Expected entry price (for logging)
  accountType: z.enum(['invest', 'isa']),
  // Additional metadata for DB position creation
  atrAtEntry: z.coerce.number().positive().optional(),
  adxAtEntry: z.coerce.number().positive().optional(),
  scanStatus: z.string().optional(),
  bqsScore: z.coerce.number().optional(),
  fwsScore: z.coerce.number().optional(),
  ncsScore: z.coerce.number().optional(),
  dualScoreAction: z.string().optional(),
  rankScore: z.coerce.number().optional(),
  entryType: z.string().optional(),
  notes: z.string().optional(),
});

// ── Execution Log Helper ─────────────────────────────────────

async function logExecution(data: {
  ticker: string;
  phase: string;
  orderId?: string | null;
  requestBody: string;
  responseStatus?: number | null;
  responseBody?: string | null;
  stopPrice?: number | null;
  quantity?: number | null;
  accountType: string;
  error?: string | null;
}): Promise<void> {
  try {
    await prisma.executionLog.create({
      data: {
        ticker: data.ticker,
        phase: data.phase,
        orderId: data.orderId ?? null,
        requestBody: data.requestBody,
        responseStatus: data.responseStatus ?? null,
        responseBody: data.responseBody ?? null,
        stopPrice: data.stopPrice ?? null,
        quantity: data.quantity ?? null,
        accountType: data.accountType,
        error: data.error ?? null,
      },
    });
  } catch (logErr) {
    // Never let logging failures abort execution
    console.error('[ExecutionLog] Failed to write log:', logErr);
  }
}

// ── T212 Client Factory ──────────────────────────────────────

async function getT212Client(userId: string, accountType: T212AccountType): Promise<Trading212Client> {
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
    },
  });

  if (!user) throw new Error('User not found');

  if (accountType === 'isa') {
    if (!user.t212IsaApiKey || !user.t212IsaApiSecret || !user.t212IsaConnected) {
      throw new Error('Trading 212 ISA account not connected. Go to Settings to add your ISA API credentials.');
    }
    return new Trading212Client(
      user.t212IsaApiKey,
      user.t212IsaApiSecret,
      user.t212Environment as 'demo' | 'live'
    );
  }

  if (!user.t212ApiKey || !user.t212ApiSecret || !user.t212Connected) {
    throw new Error('Trading 212 Invest account not connected. Go to Settings to add your API credentials.');
  }
  return new Trading212Client(
    user.t212ApiKey,
    user.t212ApiSecret,
    user.t212Environment as 'demo' | 'live'
  );
}

// ── Safety Assertions ────────────────────────────────────────

async function validateSafetyAssertions(
  stockId: string,
  t212Ticker: string,
  stopPrice: number,
  quantity: number,
  accountType: T212AccountType
): Promise<{ ok: boolean; error?: string; resolvedT212Ticker?: string; resolvedStockId?: string }> {
  // 1. stopPrice > 0
  if (stopPrice <= 0) {
    return { ok: false, error: 'ABORT: stopPrice must be > 0' };
  }

  // 2. quantity > 0 (buy side)
  if (quantity <= 0) {
    return { ok: false, error: 'ABORT: quantity must be > 0' };
  }

  // 3. t212Ticker exists on Stock record
  // Support both Prisma cuid (from auto-trade) and ticker string (from BuyConfirmationModal)
  let stock = await prisma.stock.findUnique({
    where: { id: stockId },
    select: { id: true, t212Ticker: true, isaEligible: true, ticker: true },
  });
  if (!stock) {
    // Fallback: try looking up by ticker (frontend sends candidate.ticker as stockId)
    stock = await prisma.stock.findUnique({
      where: { ticker: stockId },
      select: { id: true, t212Ticker: true, isaEligible: true, ticker: true },
    });
  }

  if (!stock) {
    return { ok: false, error: 'ABORT: Stock not found in database' };
  }

  if (!stock.t212Ticker) {
    return { ok: false, error: `ABORT: No T212 ticker mapped for ${stock.ticker}. Set it in the database first.` };
  }

  // Use the DB's authoritative t212Ticker — the frontend may send the Yahoo ticker
  // as t212Ticker which would mismatch. The DB is the source of truth.

  // 4. ISA eligibility check — abort if explicitly ineligible
  if (accountType === 'isa' && stock.isaEligible === false) {
    return { ok: false, error: `ABORT: ${stock.ticker} is not ISA eligible — cannot buy on ISA account` };
  }

  return { ok: true, resolvedT212Ticker: stock.t212Ticker, resolvedStockId: stock.id };
}

// ── SSE Helpers ──────────────────────────────────────────────

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Main Execution Handler (SSE) ─────────────────────────────

/**
 * POST /api/positions/execute
 *
 * Executes a buy order on Trading 212 with full audit logging.
 * Returns Server-Sent Events for real-time progress:
 *   event: phase    — phase status updates
 *   event: complete — final result with position data
 *   event: error    — abort with error details
 */
export async function POST(request: NextRequest) {
  // Parse and validate request body
  let body: z.infer<typeof executeSchema>;
  try {
    const rawBody = await request.json();
    body = executeSchema.parse(rawBody);
  } catch (err) {
    const msg = err instanceof z.ZodError
      ? err.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      : 'Invalid request body';
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    userId, stockId, ticker, t212Ticker, quantity, stopPrice,
    entryPrice, accountType, atrAtEntry, adxAtEntry, scanStatus,
    bqsScore, fwsScore, ncsScore, dualScoreAction, rankScore,
    entryType, notes,
  } = body;

  // Ensure user exists
  const resolvedUserId = userId || await ensureDefaultUser();

  // ── Create SSE stream ──

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(sseMessage(event, data)));
        } catch {
          // Stream may be closed
        }
      };

      const phases: ExecutionPhase[] = [
        { phase: 'BUY_PLACED', status: 'pending', message: 'Placing buy order...' },
        { phase: 'BUY_POLLING', status: 'pending', message: 'Waiting for fill...' },
        { phase: 'STOP_PLACED', status: 'pending', message: 'Setting stop-loss...' },
        { phase: 'DB_POSITION', status: 'pending', message: 'Saving position...' },
      ];

      const updatePhase = (idx: number, update: Partial<ExecutionPhase>) => {
        phases[idx] = { ...phases[idx], ...update };
        send('phase', { phases, currentPhase: idx });
      };

      try {
        try {
          await assertSubmissionAllowed({ automated: false });
        } catch (error) {
          const message = error instanceof SafetyControlError ? error.message : 'Submission blocked by safety controls.';
          await logExecution({
            ticker,
            phase: 'KILL_SWITCH_BLOCK',
            requestBody: JSON.stringify(body),
            accountType,
            error: message,
          });
          send('error', { error: message, phase: 'KILL_SWITCH_BLOCK' });
          controller.close();
          return;
        }

        // ── SAFETY ASSERTIONS ──
        const safety = await validateSafetyAssertions(stockId, t212Ticker, stopPrice, quantity, accountType);
        if (!safety.ok) {
          await logExecution({
            ticker, phase: 'SAFETY_ABORT', requestBody: JSON.stringify(body),
            accountType, error: safety.error,
          });
          send('error', { error: safety.error, phase: 'SAFETY_ABORT' });
          controller.close();
          return;
        }

        // Use DB-resolved values — the frontend may send ticker as stockId/t212Ticker
        const resolvedT212Ticker = safety.resolvedT212Ticker || t212Ticker;
        const resolvedStockId = safety.resolvedStockId || stockId;

        // ── PRE-EXECUTION DRY RUN ──
        const regime = await getMarketRegime().catch(() => undefined);
        const dryRun = await runPreExecutionDryRun({
          userId: resolvedUserId,
          ticker,
          entryPrice,
          stopPrice,
          quantity,
          accountType,
          regime,
          ncsScore,
          fwsScore,
          dualScoreAction,
        });

        if (!dryRun.passed) {
          const failureMsg = dryRun.summary;
          await logExecution({
            ticker, phase: 'DRY_RUN_FAIL', requestBody: JSON.stringify(body),
            accountType, error: failureMsg,
          });
          send('error', {
            error: failureMsg,
            phase: 'DRY_RUN_FAIL',
            dryRunChecks: dryRun.checks,
            hardFailures: dryRun.hardFailures,
          });
          controller.close();
          return;
        }

        // ── Get T212 Client ──
        let client: Trading212Client;
        try {
          client = await getT212Client(resolvedUserId, accountType);
        } catch (err) {
          const msg = (err as Error).message;
          await logExecution({
            ticker, phase: 'CLIENT_ERROR', requestBody: JSON.stringify(body),
            accountType, error: msg,
          });
          send('error', { error: msg, phase: 'CLIENT_ERROR' });
          controller.close();
          return;
        }

        // ════════════════════════════════════════════════════
        //  PHASE A: Place Market Buy Order
        // ════════════════════════════════════════════════════

        updatePhase(0, { status: 'running' });

        let buyOrder: T212PendingOrder;
        const buyRequest = { quantity, ticker: resolvedT212Ticker };

        try {
          buyOrder = await client.placeMarketOrder(buyRequest);

          await logExecution({
            ticker, phase: 'BUY_PLACED',
            orderId: String(buyOrder.id),
            requestBody: JSON.stringify(buyRequest),
            responseStatus: 200,
            responseBody: JSON.stringify(buyOrder),
            quantity,
            accountType,
          });

          updatePhase(0, {
            status: 'success',
            message: `Buy order placed (ID: ${buyOrder.id})`,
            orderId: buyOrder.id,
          });
        } catch (err) {
          const msg = err instanceof Trading212Error
            ? `T212 API error ${err.statusCode}: ${err.message}`
            : (err as Error).message;

          await logExecution({
            ticker, phase: 'BUY_FAILED',
            requestBody: JSON.stringify(buyRequest),
            responseStatus: err instanceof Trading212Error ? err.statusCode : null,
            accountType, error: msg,
          });

          // Phase A failure → ABORT ENTIRELY
          updatePhase(0, { status: 'failed', message: msg });
          send('error', { error: msg, phase: 'BUY_FAILED', critical: false });
          controller.close();
          return;
        }

        // ════════════════════════════════════════════════════
        //  PHASE B: Poll for Fill (every 3s, max 20 attempts)
        // ════════════════════════════════════════════════════

        updatePhase(1, { status: 'running' });

        let filledOrder: T212PendingOrder | null = null;
        let filledQuantity = 0;
        let filledPrice = 0;
        const MAX_POLLS = 20;
        const POLL_INTERVAL_MS = 3000;

        for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

          try {
            const order = await client.getOrder(buyOrder.id);

            await logExecution({
              ticker, phase: 'BUY_POLLING',
              orderId: String(buyOrder.id),
              requestBody: JSON.stringify({ orderId: buyOrder.id, attempt }),
              responseStatus: 200,
              responseBody: JSON.stringify(order),
              quantity,
              accountType,
            });

            // Check if filled — T212 returns filledQuantity > 0 when (partially) filled
            if (order.filledQuantity > 0 && order.filledQuantity >= quantity * 0.99) {
              filledOrder = order;
              filledQuantity = order.filledQuantity;
              // Approximate fill price from filledValue / filledQuantity
              filledPrice = order.filledValue > 0 && order.filledQuantity > 0
                ? order.filledValue / order.filledQuantity
                : entryPrice;
              break;
            }

            updatePhase(1, {
              status: 'running',
              message: `Waiting for fill... (${attempt}/${MAX_POLLS})`,
            });
          } catch (err) {
            // 404 on getOrder often means the order was already filled and removed from pending
            if (err instanceof Trading212Error && err.statusCode === 404) {
              // Order filled and no longer pending — check positions for the fill
              try {
                const positions = await client.getPositions();
                const pos = positions.find(p => p.instrument.ticker === t212Ticker);
                if (pos) {
                  filledQuantity = pos.quantity;
                  filledPrice = pos.averagePricePaid;
                  filledOrder = buyOrder; // Use the original order reference
                  break;
                }
              } catch {
                // Fall through to timeout
              }
            }
            // Log but don't abort — keep polling
            console.warn(`[Execute] Poll attempt ${attempt} error:`, (err as Error).message);
          }
        }

        if (!filledOrder || filledQuantity === 0) {
          // Timeout — order may still fill later
          await logExecution({
            ticker, phase: 'BUY_TIMEOUT',
            orderId: String(buyOrder.id),
            requestBody: JSON.stringify({ orderId: buyOrder.id, maxPolls: MAX_POLLS }),
            accountType,
            error: `Fill not confirmed after ${MAX_POLLS} polls (${MAX_POLLS * POLL_INTERVAL_MS / 1000}s). Order may still fill. Do NOT place stop.`,
          });

          updatePhase(1, {
            status: 'failed',
            message: `Fill not confirmed after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s — check T212 app manually`,
          });
          // Phase C skipped — DO NOT place stop without confirmed fill
          updatePhase(2, { status: 'skipped', message: 'Skipped — fill not confirmed' });
          updatePhase(3, { status: 'skipped', message: 'Skipped — fill not confirmed' });

          send('error', {
            error: `Buy order ${buyOrder.id} placed but fill not confirmed after ${MAX_POLLS * POLL_INTERVAL_MS / 1000}s. Check the T212 app. Do NOT manually place a stop until the fill is confirmed.`,
            phase: 'BUY_TIMEOUT',
            critical: false,
            orderId: buyOrder.id,
          });
          controller.close();
          return;
        }

        updatePhase(1, {
          status: 'success',
          message: `Filled ${filledQuantity} shares @ ${filledPrice.toFixed(4)}`,
          filledQuantity,
          filledPrice,
        });

        // ════════════════════════════════════════════════════
        //  PHASE C: Place Stop-Loss (NEGATIVE quantity)
        // ════════════════════════════════════════════════════

        updatePhase(2, { status: 'running' });

        // Safety: stop quantity MUST be negative
        const stopQuantity = -Math.abs(filledQuantity);
        if (stopQuantity >= 0) {
          // This should never happen but we check anyway
          const errMsg = `CRITICAL: stopQuantity is not negative (${stopQuantity}). Aborting stop placement.`;
          await logExecution({
            ticker, phase: 'STOP_FAILED',
            requestBody: JSON.stringify({ stopQuantity, stopPrice }),
            accountType, error: errMsg, stopPrice,
          });
          updatePhase(2, { status: 'failed', message: errMsg });
          // Still create DB position but flag the stop issue
          send('phase', { phases, currentPhase: 2, warning: errMsg });
        } else {
          const stopRequest = {
            quantity: stopQuantity,
            stopPrice,
            ticker: resolvedT212Ticker,
            timeValidity: 'GOOD_TILL_CANCEL' as const,
          };

          try {
            const stopOrder = await client.placeStopOrder(stopRequest);

            await logExecution({
              ticker, phase: 'STOP_PLACED',
              orderId: String(stopOrder.id),
              requestBody: JSON.stringify(stopRequest),
              responseStatus: 200,
              responseBody: JSON.stringify(stopOrder),
              stopPrice,
              quantity: stopQuantity,
              accountType,
            });

            updatePhase(2, {
              status: 'success',
              message: `Stop-loss set @ ${stopPrice.toFixed(4)} (ID: ${stopOrder.id})`,
              orderId: stopOrder.id,
            });
          } catch (err) {
            const msg = err instanceof Trading212Error
              ? `T212 API error ${err.statusCode}: ${err.message}`
              : (err as Error).message;

            await logExecution({
              ticker, phase: 'STOP_FAILED',
              requestBody: JSON.stringify(stopRequest),
              responseStatus: err instanceof Trading212Error ? err.statusCode : null,
              accountType, error: msg, stopPrice,
              quantity: stopQuantity,
            });

            // CRITICAL: Stop failed but shares are bought — user MUST set stop manually
            updatePhase(2, { status: 'failed', message: `CRITICAL: ${msg}` });

            // Don't abort — still create DB position, but send critical warning
            send('phase', {
              phases,
              currentPhase: 2,
              critical: true,
              warning: `CRITICAL: Stop-loss failed to place on T212. You MUST set a stop-loss manually at ${stopPrice.toFixed(4)} immediately. Error: ${msg}`,
            });
          }
        }

        // ════════════════════════════════════════════════════
        //  PHASE D: Create DB Position (reuse existing POST logic)
        // ════════════════════════════════════════════════════

        updatePhase(3, { status: 'running' });

        try {
          // Call the existing position creation endpoint internally
          const positionResponse = await fetch(new URL('/api/positions', request.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: resolvedUserId,
              stockId: resolvedStockId,
              entryPrice: filledPrice,
              shares: filledQuantity,
              stopLoss: stopPrice,
              atrAtEntry,
              adxAtEntry,
              scanStatus,
              bqsScore,
              fwsScore,
              ncsScore,
              dualScoreAction,
              rankScore,
              entryType: entryType || 'BREAKOUT',
              plannedEntry: entryPrice,
              accountType,
              notes: notes || `T212 auto-execute: Order ${buyOrder.id}`,
            }),
          });

          const positionData = await positionResponse.json();

          if (!positionResponse.ok) {
            const errMsg = positionData.message || positionData.error || 'Failed to create DB position';

            await logExecution({
              ticker, phase: 'DB_POSITION_FAILED',
              orderId: String(buyOrder.id),
              requestBody: JSON.stringify({ filledPrice, filledQuantity, stopPrice }),
              responseStatus: positionResponse.status,
              responseBody: JSON.stringify(positionData),
              accountType, error: errMsg,
            });

            updatePhase(3, { status: 'failed', message: errMsg });
            send('error', {
              error: `Position record failed to save. The trade IS live on T212. Create manually: ${filledQuantity} shares @ ${filledPrice.toFixed(4)}, stop @ ${stopPrice.toFixed(4)}`,
              phase: 'DB_POSITION_FAILED',
              critical: true,
              orderId: buyOrder.id,
            });
            controller.close();
            return;
          }

          await logExecution({
            ticker, phase: 'COMPLETE',
            orderId: String(buyOrder.id),
            requestBody: JSON.stringify({ positionId: positionData.id }),
            responseStatus: 201,
            responseBody: JSON.stringify(positionData),
            stopPrice,
            quantity: filledQuantity,
            accountType,
          });

          updatePhase(3, {
            status: 'success',
            message: `Position saved (ID: ${positionData.id?.slice(0, 8)}...)`,
          });

          // ── SUCCESS ──
          send('complete', {
            phases,
            position: {
              id: positionData.id,
              ticker,
              t212Ticker,
              filledQuantity,
              filledPrice,
              stopPrice,
              orderId: buyOrder.id,
              accountType,
            },
            // Flag if stop placement failed (phases[2].status === 'failed')
            stopFailed: phases[2].status === 'failed',
          });

        } catch (err) {
          const msg = (err as Error).message;
          await logExecution({
            ticker, phase: 'DB_POSITION_FAILED',
            requestBody: JSON.stringify({ filledPrice, filledQuantity }),
            accountType, error: msg,
          });

          updatePhase(3, { status: 'failed', message: msg });
          send('error', {
            error: `Position record failed. Trade IS live on T212: ${filledQuantity} shares @ ${filledPrice.toFixed(4)}. Create position manually.`,
            phase: 'DB_POSITION_FAILED',
            critical: true,
          });
        }

      } catch (err) {
        // Unexpected top-level error
        const msg = (err as Error).message || 'Unexpected execution error';
        await logExecution({
          ticker, phase: 'UNEXPECTED_ERROR',
          requestBody: JSON.stringify(body),
          accountType, error: msg,
        });
        send('error', { error: msg, phase: 'UNEXPECTED_ERROR', critical: true });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
