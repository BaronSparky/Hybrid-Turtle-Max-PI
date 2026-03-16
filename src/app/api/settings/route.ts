export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { ensureDefaultUser } from '@/lib/default-user';
import { recordEquitySnapshot } from '@/lib/equity-snapshot';
import { apiError } from '@/lib/api-response';
import { z } from 'zod';
import { isT212FromEnv, isTelegramFromEnv } from '@/lib/secrets';

const settingsPutSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'SMALL_ACCOUNT', 'AGGRESSIVE']).optional(),
  equity: z.number().positive('Equity must be positive').optional(),
  startingEquityOverride: z.number().positive('Starting equity must be positive').nullable().optional(),
  marketDataProvider: z.enum(['yahoo', 'eodhd']).optional(),
  eodhApiKey: z.string().nullable().optional(),
  // Gap guard settings
  gapGuardMode: z.enum(['ALL', 'MONDAY_ONLY']).optional(),
  gapGuardWeekendATR: z.number().min(0.1).max(5.0).optional(),
  gapGuardWeekendPct: z.number().min(0.5).max(20.0).optional(),
  gapGuardDailyATR: z.number().min(0.1).max(5.0).optional(),
  gapGuardDailyPct: z.number().min(0.5).max(20.0).optional(),
  // Prediction engine toggles
  showIntradayNCS: z.boolean().optional(),
  applyKellyMultiplier: z.boolean().optional(),
  rlShadowMode: z.boolean().optional(),
  modelLayerEnabled: z.boolean().optional(),
  // Telegram credentials
  telegramBotToken: z.string().trim().min(1).nullable().optional(),
  telegramChatId: z.string().trim().min(1).nullable().optional(),
});

// GET /api/settings?userId=default-user
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || 'default-user';

    await ensureDefaultUser();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        riskProfile: true,
        equity: true,
        startingEquityOverride: true,
        marketDataProvider: true,
        eodhApiKey: true,
        // Gap Guard config
        gapGuardMode: true,
        gapGuardWeekendATR: true,
        gapGuardWeekendPct: true,
        gapGuardDailyATR: true,
        gapGuardDailyPct: true,
        // Telegram credentials
        telegramBotToken: true,
        telegramChatId: true,
        // Prediction engine toggles
        showIntradayNCS: true,
        applyKellyMultiplier: true,
        rlShadowMode: true,
        modelLayerEnabled: true,
        // Trading 212 Invest
        t212ApiKey: true,
        t212ApiSecret: true,
        t212Environment: true,
        t212Connected: true,
        t212AccountId: true,
        t212Currency: true,
        t212LastSync: true,
        // Trading 212 ISA
        t212IsaApiKey: true,
        t212IsaApiSecret: true,
        t212IsaConnected: true,
        t212IsaAccountId: true,
        t212IsaCurrency: true,
        t212IsaLastSync: true,
      },
    });

    if (!user) {
      return apiError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Mask EODHD API key (only show last 4 chars)
    const maskedKey = user.eodhApiKey
      ? '****' + user.eodhApiKey.slice(-4)
      : null;

    // Mask T212 keys — show last 4 chars only
    const maskKey = (k: string | null) => k ? '****' + k.slice(-4) : null;

    // Mask Telegram bot token — show last 4 chars only
    const maskedTelegramToken = user.telegramBotToken
      ? '****' + user.telegramBotToken.slice(-4)
      : null;

    // Settings change rarely — cache for 5 minutes, serve stale for 1 min while revalidating
    return NextResponse.json({
      ...user,
      eodhApiKey: maskedKey,
      eodhApiKeySet: !!user.eodhApiKey,
      // Replace raw keys with masked versions
      t212ApiKey: maskKey(user.t212ApiKey),
      t212ApiSecret: maskKey(user.t212ApiSecret),
      t212IsaApiKey: maskKey(user.t212IsaApiKey),
      t212IsaApiSecret: maskKey(user.t212IsaApiSecret),
      // Telegram: mask token, expose chatId for display
      telegramBotToken: maskedTelegramToken,
      telegramBotTokenSet: !!user.telegramBotToken,
      telegramChatId: user.telegramChatId,
      // Credential source flags — used by Settings UI to show read-only when from ENV
      t212FromEnv: isT212FromEnv(),
      telegramFromEnv: isTelegramFromEnv(),
    }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('GET /api/settings error:', error);
    return apiError(500, 'SETTINGS_FETCH_FAILED', 'Failed to fetch settings', (error as Error).message, true);
  }
}

// PUT /api/settings — save risk profile and equity
export async function PUT(request: NextRequest) {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return apiError(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }

    const parsed = settingsPutSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(
        400,
        'INVALID_REQUEST',
        'Invalid settings payload',
        parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
      );
    }

    const { riskProfile, equity, startingEquityOverride, marketDataProvider, eodhApiKey,
      gapGuardMode, gapGuardWeekendATR, gapGuardWeekendPct, gapGuardDailyATR, gapGuardDailyPct,
      showIntradayNCS, applyKellyMultiplier, rlShadowMode, modelLayerEnabled,
    } = parsed.data;
    const id = parsed.data.userId || 'default-user';

    const data: Record<string, unknown> = {};
    if (riskProfile) data.riskProfile = riskProfile;
    if (equity !== undefined) data.equity = equity;
    if (startingEquityOverride !== undefined) data.startingEquityOverride = startingEquityOverride;
    if (marketDataProvider) data.marketDataProvider = marketDataProvider;
    // Only update eodhApiKey if explicitly provided (not the masked version)
    if (eodhApiKey !== undefined && eodhApiKey !== null && !eodhApiKey.startsWith('****')) {
      data.eodhApiKey = eodhApiKey || null;
    }
    // Gap guard fields
    if (gapGuardMode !== undefined) data.gapGuardMode = gapGuardMode;
    if (gapGuardWeekendATR !== undefined) data.gapGuardWeekendATR = gapGuardWeekendATR;
    if (gapGuardWeekendPct !== undefined) data.gapGuardWeekendPct = gapGuardWeekendPct;
    if (gapGuardDailyATR !== undefined) data.gapGuardDailyATR = gapGuardDailyATR;
    if (gapGuardDailyPct !== undefined) data.gapGuardDailyPct = gapGuardDailyPct;
    // Prediction engine toggles
    if (showIntradayNCS !== undefined) data.showIntradayNCS = showIntradayNCS;
    if (applyKellyMultiplier !== undefined) data.applyKellyMultiplier = applyKellyMultiplier;
    if (rlShadowMode !== undefined) data.rlShadowMode = rlShadowMode;
    if (modelLayerEnabled !== undefined) data.modelLayerEnabled = modelLayerEnabled;
    // Telegram credentials — only update if not masked
    const { telegramBotToken, telegramChatId } = parsed.data;
    if (telegramBotToken !== undefined && telegramBotToken !== null && !telegramBotToken.startsWith('****')) {
      data.telegramBotToken = telegramBotToken || null;
    }
    if (telegramChatId !== undefined) {
      data.telegramChatId = telegramChatId || null;
    }

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        riskProfile: true,
        equity: true,
        marketDataProvider: true,
      },
    });

    await recordEquitySnapshot(id, user.equity);

    return NextResponse.json(user);
  } catch (error) {
    console.error('PUT /api/settings error:', error);
    return apiError(500, 'SETTINGS_SAVE_FAILED', 'Failed to save settings', (error as Error).message, true);
  }
}
