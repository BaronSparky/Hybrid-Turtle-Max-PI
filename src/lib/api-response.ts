import { NextRequest, NextResponse } from 'next/server';

export interface ApiErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: string;
    retryable?: boolean;
  };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: string,
  retryable?: boolean
) {
  // Log full error details server-side; suppress from client in production
  if (details && process.env.NODE_ENV === 'production') {
    console.error(`[apiError] ${code}: ${details}`);
  }
  const safeDetails = process.env.NODE_ENV === 'production' ? undefined : details;
  return NextResponse.json<ApiErrorPayload>(
    {
      ok: false,
      error: { code, message, details: safeDetails, retryable },
    },
    { status }
  );
}

/**
 * Verify the CRON_SECRET header on scheduled/cron endpoints.
 * Returns null if valid, or a 401 NextResponse if invalid.
 *
 * CRON_SECRET is enforced even when DISABLE_API_AUTH=true. The desktop
 * auth-bypass flag governs session-based UI auth only; cron endpoints
 * trigger real-money pipelines (nightly stop ladder, workflow tonight)
 * and must remain protected so a stray HTTP request on localhost cannot
 * fire them. The audit on 2026-05-16 flagged the previous bypass as a
 * defence-in-depth gap.
 */
export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const secret = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace('Bearer ', '');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing cron secret' } },
      { status: 401 }
    );
  }
  return null;
}
