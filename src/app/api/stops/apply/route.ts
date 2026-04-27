/**
 * DEPENDENCIES
 * Consumed by: StopUpdateQueue.tsx (portfolio/positions)
 * Consumes: stop-manager.ts (updateStopLoss), trading212.ts (setStopLoss), prisma.ts
 * Risk-sensitive: YES — writes stop values to DB and places T212 orders
 * Last modified: 2026-03-03
 * Notes: One-click stop application — DB write + T212 push in a single call.
 *        If T212 fails, returns step: "T212". If DB fails after T212 succeeds, returns step: "DB".
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { updateStopLoss, inferLevelFromStop, StopLossError } from '@/lib/stop-manager';
import { Trading212Client, Trading212Error } from '@/lib/trading212';
import type { T212AccountType } from '@/lib/trading212-dual';
import { ensureDefaultUser } from '@/lib/default-user';
import { parseJsonBody } from '@/lib/request-validation';
import { apiError } from '@/lib/api-response';
import { decryptField } from '@/lib/crypto';

const applyStopSchema = z.object({
  positionId: z.string().trim().min(1, 'positionId is required'),
  newStop: z.coerce.number().positive('newStop must be a positive number'),
});

/**
 * Helper: create a T212 client from the user's stored credentials.
 * Routes to the correct account (Invest or ISA) based on accountType.
 * Mirrors the same logic in /api/stops/t212/route.ts.
 */
async function getT212Client(userId: string, accountType?: T212AccountType | string | null) {
  const acctType: T212AccountType = (accountType === 'isa') ? 'isa' : 'invest';

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

  if (!user) throw new Error('User not found.');

  if (acctType === 'isa') {
    if (!user.t212IsaApiKey || !user.t212IsaApiSecret || !user.t212IsaConnected) {
      throw new Error('Trading 212 ISA account not connected.');
    }
    return new Trading212Client(
      decryptField(user.t212IsaApiKey),
      decryptField(user.t212IsaApiSecret),
      user.t212Environment as 'demo' | 'live'
    );
  }

  if (!user.t212ApiKey || !user.t212ApiSecret || !user.t212Connected) {
    throw new Error('Trading 212 Invest account not connected.');
  }
  return new Trading212Client(
    decryptField(user.t212ApiKey),
    decryptField(user.t212ApiSecret),
    user.t212Environment as 'demo' | 'live'
  );
}

/**
 * POST /api/stops/apply
 *
 * One-click stop application: DB write + T212 push in a single request.
 *
 * Steps:
 * 1. Load position — verify exists and is OPEN
 * 2. Load T212 credentials, build client for the correct account
 * 3. Push stop to T212 (cancel old + place new, monotonic enforcement)
 * 4. Record new stop in DB via updateStopLoss (SACRED function — not modified)
 * 5. Return success with the resulting protection level
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, applyStopSchema);
    if (!parsed.ok) return parsed.response;
    const { positionId, newStop } = parsed.data;

    // ── Step 1: Load position ──
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { stock: true },
    });

    if (!position) {
      return NextResponse.json({ success: false, error: 'Position not found', step: 'DB' }, { status: 404 });
    }
    if (position.status === 'CLOSED') {
      return NextResponse.json({ success: false, error: 'Cannot update stop on a closed position', step: 'DB' }, { status: 400 });
    }

    const t212Ticker = position.t212Ticker || position.stock.t212Ticker;
    const primaryAcctType: T212AccountType = position.accountType === 'isa' ? 'isa' : 'invest';

    // ── Step 2 & 3: Push to T212 (if credentials available) ──
    let t212Success = false;
    let t212Message = '';
    let t212Skipped = false;

    if (t212Ticker) {
      try {
        const client = await getT212Client(position.userId, primaryAcctType);
        let usedAcctType = primaryAcctType;

        try {
          await client.setStopLoss(t212Ticker, position.shares, newStop);
        } catch (primaryErr) {
          // If T212 says "not owned", try the OTHER account (ISA↔Invest)
          const isNotOwned = primaryErr instanceof Trading212Error
            && (primaryErr.message.includes('selling-equity-not-owned')
              || primaryErr.message.includes('not found in T212 positions'));

          if (!isNotOwned) throw primaryErr;

          const fallbackAcctType: T212AccountType = primaryAcctType === 'invest' ? 'isa' : 'invest';
          const fallbackClient = await getT212Client(position.userId, fallbackAcctType);
          await fallbackClient.setStopLoss(t212Ticker, position.shares, newStop);
          usedAcctType = fallbackAcctType;

          // Fix the position's accountType in DB
          await prisma.position.update({
            where: { id: positionId },
            data: { accountType: fallbackAcctType },
          });
        }

        t212Success = true;
        t212Message = `T212 stop placed (${usedAcctType.toUpperCase()})`;
      } catch (t212Err) {
        // T212 failed — return immediately so user knows to fix it
        const errMsg = t212Err instanceof Trading212Error
          ? t212Err.message
          : (t212Err as Error).message;

        // If it's a "stale stop" response from setStopLoss distance check, surface that clearly
        return NextResponse.json({
          success: false,
          error: `T212: ${errMsg}`,
          step: 'T212' as const,
        }, { status: 400 });
      }
    } else {
      // No T212 ticker mapped — skip T212, still apply DB
      t212Skipped = true;
      t212Message = 'No T212 ticker mapped — DB-only update';
    }

    // ── Step 4: Record in DB via updateStopLoss (SACRED — monotonic enforcement) ──
    let protectionLevel: string;
    try {
      const reason = t212Success
        ? `Applied via dashboard: T212 + DB (${newStop.toFixed(2)})`
        : `Applied via dashboard: DB only (${newStop.toFixed(2)})`;
      await updateStopLoss(positionId, newStop, reason);
      protectionLevel = inferLevelFromStop(newStop, position.entryPrice, position.initialRisk);
    } catch (dbErr) {
      if (dbErr instanceof StopLossError) {
        // Monotonic violation or position-not-found from stop-manager
        // If T212 already succeeded, tell the user to verify
        if (t212Success) {
          return NextResponse.json({
            success: false,
            error: `T212 stop was placed, but DB update failed: ${dbErr.message}. Please verify the stop manually.`,
            step: 'DB' as const,
          }, { status: 400 });
        }
        return NextResponse.json({
          success: false,
          error: dbErr.message,
          step: 'DB' as const,
        }, { status: 400 });
      }
      // Unknown DB error
      if (t212Success) {
        return NextResponse.json({
          success: false,
          error: `T212 stop was placed, but DB update failed unexpectedly. Please verify the stop manually.`,
          step: 'DB' as const,
        }, { status: 500 });
      }
      throw dbErr;
    }

    // ── Step 5: Return success ──
    return NextResponse.json({
      success: true,
      positionId,
      newStop,
      protectionLevel,
      message: t212Skipped
        ? `Stop updated to ${newStop.toFixed(2)} (DB only — no T212 ticker mapped)`
        : `Stop updated to ${newStop.toFixed(2)} on T212 + DB`,
    });
  } catch (error) {
    console.error('[stops/apply] Error:', error);
    if (error instanceof Trading212Error) {
      return apiError(error.statusCode === 429 ? 429 : 400, 'T212_ERROR', error.message, undefined, error.statusCode === 429);
    }
    return apiError(500, 'STOP_APPLY_FAILED', (error as Error).message, undefined, true);
  }
}
