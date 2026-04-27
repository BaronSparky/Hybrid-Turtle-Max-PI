export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Trading212Client } from '@/lib/trading212';
import { ensureDefaultUser } from '@/lib/default-user';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { encryptField } from '@/lib/crypto';

const connectSchema = z.object({
  apiKey: z.string().trim().min(1),
  apiSecret: z.string().trim().min(1),
  environment: z.enum(['demo', 'live']).optional(),
  userId: z.string().trim().min(1).optional(),
  accountType: z.enum(['invest', 'isa']).optional(), // Which T212 account to connect
});

// POST /api/trading212/connect — Test connection and save credentials
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, connectSchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const { apiKey, apiSecret, environment = 'demo', accountType = 'invest' } = parsed.data;
    let { userId } = parsed.data;

    // Ensure user exists
    if (!userId) {
      userId = await ensureDefaultUser();
    }
    // Test the connection
    const client = new Trading212Client(apiKey, apiSecret, environment);
    const result = await client.testConnection();

    if (!result.ok) {
      return apiError(400, 'T212_CONNECT_FAILED', result.error || 'Failed to connect to Trading 212');
    }

    // Save credentials to user profile — ISA uses separate DB fields
    await ensureDefaultUser();

    if (accountType === 'isa') {
      await prisma.user.update({
        where: { id: userId },
        data: {
          t212IsaApiKey: encryptField(apiKey),
          t212IsaApiSecret: encryptField(apiSecret),
          t212IsaConnected: true,
          t212IsaAccountId: result.accountId?.toString(),
          t212IsaCurrency: result.currency,
          // ISA shares environment with Invest — save it so that if ISA
          // is connected first (before Invest), the correct env is persisted
          t212Environment: environment,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: userId },
        data: {
          t212ApiKey: encryptField(apiKey),
          t212ApiSecret: encryptField(apiSecret),
          t212Environment: environment,
          t212Connected: true,
          t212AccountId: result.accountId?.toString(),
          t212Currency: result.currency,
        },
      });
    }

    return NextResponse.json({
      success: true,
      accountId: result.accountId,
      currency: result.currency,
      environment,
      accountType,
    });
  } catch (error) {
    console.error('Trading 212 connect error:', error);
    return apiError(500, 'T212_CONNECT_FAILED', (error as Error).message || 'Failed to connect to Trading 212', undefined, true);
  }
}

// DELETE /api/trading212/connect — Disconnect Trading 212 (invest or isa)
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    let userId = searchParams.get('userId');
    const accountType = searchParams.get('accountType') || 'invest';

    if (!userId) {
      userId = await ensureDefaultUser();
    }

    if (accountType === 'isa') {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            t212IsaApiKey: null,
            t212IsaApiSecret: null,
            t212IsaConnected: false,
            t212IsaLastSync: null,
            t212IsaAccountId: null,
            t212IsaCurrency: null,
            t212IsaCash: null,
            t212IsaInvested: null,
            t212IsaUnrealisedPL: null,
            t212IsaTotalValue: null,
          },
        }),
        // Close orphaned positions for this account type
        prisma.position.updateMany({
          where: { userId, source: 'trading212', accountType: 'isa', status: 'OPEN' },
          data: { status: 'CLOSED', exitDate: new Date(), exitReason: 'ISA account disconnected' },
        }),
      ]);
    } else {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            t212ApiKey: null,
            t212ApiSecret: null,
            t212Connected: false,
            t212LastSync: null,
            t212AccountId: null,
            t212Currency: null,
            t212Cash: null,
            t212Invested: null,
            t212UnrealisedPL: null,
            t212TotalValue: null,
          },
        }),
        // Close orphaned positions for this account type
        prisma.position.updateMany({
          where: { userId, source: 'trading212', accountType: 'invest', status: 'OPEN' },
          data: { status: 'CLOSED', exitDate: new Date(), exitReason: 'Invest account disconnected' },
        }),
      ]);
    }

    return NextResponse.json({ success: true, accountType });
  } catch (error) {
    console.error('Trading 212 disconnect error:', error);
    return apiError(500, 'T212_DISCONNECT_FAILED', 'Failed to disconnect Trading 212', (error as Error).message, true);
  }
}
