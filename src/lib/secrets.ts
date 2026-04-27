/**
 * DEPENDENCIES
 * Consumed by: trading212-dual.ts, trading212.ts, position-sync.ts, telegram.ts
 * Consumes: prisma.ts
 * Risk-sensitive: YES — credentials control broker API access
 * Last modified: 2026-03-04
 * Notes: Centralised credential loading. Checks environment variables first,
 *        falls back to User table in the DB for backward compatibility.
 */

import prisma from './prisma';
import { decryptField } from './crypto';

interface T212Credentials {
  apiKey: string;
  apiSecret: string;
  environment: string;
  accountId?: string;
  connected: boolean;
}

interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

let credSourceLogged = false;

/**
 * Get Trading 212 credentials for a specific account type.
 * Priority: environment variables → database.
 */
export async function getT212Credentials(
  accountType: 'ISA' | 'INVEST',
  userId = 'default-user'
): Promise<T212Credentials | null> {
  // Check environment variables first
  if (accountType === 'INVEST') {
    const envKey = process.env.T212_INVEST_API_KEY;
    if (envKey) {
      if (!credSourceLogged) {
        console.info('[Secrets] T212 Invest credentials loaded from: ENV');
        credSourceLogged = true;
      }
      return {
        apiKey: envKey,
        apiSecret: '', // T212 API v2 only uses API key
        environment: process.env.T212_ENVIRONMENT || 'live',
        accountId: process.env.T212_INVEST_ACCOUNT_ID || undefined,
        connected: true,
      };
    }
  } else {
    const envKey = process.env.T212_ISA_API_KEY;
    if (envKey) {
      if (!credSourceLogged) {
        console.info('[Secrets] T212 ISA credentials loaded from: ENV');
        credSourceLogged = true;
      }
      return {
        apiKey: envKey,
        apiSecret: '',
        environment: process.env.T212_ENVIRONMENT || 'live',
        accountId: process.env.T212_ISA_ACCOUNT_ID || undefined,
        connected: true,
      };
    }
  }

  // Fallback to database
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        t212ApiKey: true,
        t212ApiSecret: true,
        t212Environment: true,
        t212AccountId: true,
        t212Connected: true,
        t212IsaApiKey: true,
        t212IsaApiSecret: true,
        t212IsaConnected: true,
        t212IsaAccountId: true,
      },
    });

    if (!user) return null;

    if (!credSourceLogged) {
      console.info('[Secrets] T212 credentials loaded from: DB');
      credSourceLogged = true;
    }

    if (accountType === 'INVEST') {
      if (!user.t212ApiKey || !user.t212Connected) return null;
      return {
        apiKey: decryptField(user.t212ApiKey),
        apiSecret: decryptField(user.t212ApiSecret || ''),
        environment: user.t212Environment || 'live',
        accountId: user.t212AccountId || undefined,
        connected: user.t212Connected,
      };
    } else {
      if (!user.t212IsaApiKey || !user.t212IsaConnected) return null;
      return {
        apiKey: decryptField(user.t212IsaApiKey),
        apiSecret: decryptField(user.t212IsaApiSecret || ''),
        environment: 'live',
        accountId: user.t212IsaAccountId || undefined,
        connected: user.t212IsaConnected,
      };
    }
  } catch (error) {
    console.error('[Secrets] Failed to load T212 credentials:', (error as Error).message);
    return null;
  }
}

/**
 * Get Telegram Bot credentials.
 * Priority: environment variables → database.
 */
export async function getTelegramCredentials(
  userId = 'default-user'
): Promise<TelegramCredentials | null> {
  // Check environment variables first (primary source)
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  const envChatId = process.env.TELEGRAM_CHAT_ID;

  if (envToken && envChatId) {
    return { botToken: envToken, chatId: envChatId };
  }

  // Fallback to database — credentials saved via Settings page survive rebuilds
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramBotToken: true, telegramChatId: true },
    });
    if (user?.telegramBotToken && user?.telegramChatId) {
      return { botToken: user.telegramBotToken, chatId: user.telegramChatId };
    }
  } catch (error) {
    console.error('[Secrets] Failed to load Telegram credentials:', (error as Error).message);
  }

  return null;
}

/**
 * Check whether T212 credentials are loaded from environment variables.
 * Used by the settings page to show read-only fields.
 */
export function isT212FromEnv(): boolean {
  return !!(process.env.T212_INVEST_API_KEY || process.env.T212_ISA_API_KEY);
}

/**
 * Check whether Telegram credentials are from environment variables.
 */
export function isTelegramFromEnv(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}
