/**
 * DEPENDENCIES
 * Consumed by: Settings page ("Test Inbound" button)
 * Consumes: telegram-commands.ts
 * Risk-sensitive: NO
 * Last modified: 2026-03-03
 * Notes: Internal endpoint that calls handleCommand() directly,
 *        bypassing the webhook. No tunnel required.
 */

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/request-validation';
import { parseCommand, handleCommand } from '@/lib/telegram-commands';
import { apiError } from '@/lib/api-response';

const testCommandSchema = z.object({
  command: z.string().min(1, 'command is required'),
});

/**
 * POST /api/telegram/test-command
 * Simulates an inbound Telegram command without an active webhook.
 * Returns the formatted response that would be sent to Telegram.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = await parseJsonBody(request, testCommandSchema);
    if (!parsed.ok) return parsed.response;

    const cmd = parseCommand(parsed.data.command);
    const response = await handleCommand(cmd, parsed.data.command);

    return NextResponse.json({
      command: cmd,
      response: response.text,
      parseMode: response.parseMode,
    });
  } catch (error) {
    console.error('[telegram/test-command] Error:', error);
    return apiError(500, 'TEST_COMMAND_FAILED', (error as Error).message, undefined, true);
  }
}
